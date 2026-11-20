# BHA-CI-FAST-001 — giảm thời gian CI backend

- Work item `BHA-CI-FAST-001`. Implementer `CLAUDE`, reviewer `CODEX_READ_ONLY` (Owner gọi). Branch `feature/bha-ci-fast-001-backend-tests`, base `develop`, **baseline = START_HEAD = `b8c73ff202c0c1b1b2e6f17190fa9a01282d720a`** (merge PR #136). Draft PR #137.
- Kết quả: `READY_FOR_CODEX_REVIEW`. Job Backend giảm từ khoảng 26–27 phút xuống khoảng 9,6–10 phút wall (hai lần CI), tập test không đổi (1561 integration + 676 unit), không đổi mã sản xuất, schema, test hay dependency.

## 1. Nguyên nhân (chứng cứ)

**CI trước thay đổi.** Run `44589119407` (head `5a16e3f`, cây mã **giống hệt** `b8c73ff`): job Backend 26m31s = Restore 38s + Build 50s + `dotnet test` 24m31s. Unit 676 test, 326 ms. Integration 1561 test, 24m21s. Queue 20 s. Mười lần Backend thành công gần nhất: 22–30 phút (trung bình khoảng 26). Vậy gần như toàn bộ thời gian là một lệnh: các integration test.

**Vì sao chạy tuần tự.** 82 class dùng chung `PostgreSqlCollection` (`DisableParallelization = true`), một database, một nhân của runner (4 vCPU).

**Phân bố thời gian** (bản chạy cục bộ trên cùng cây mã: PostgreSQL 17.10, tuần tự, 20m35s, tổng thời gian test 1255 s ≈ wall):

| Nhóm | Test | Thời gian | Tỷ lệ |
|---|---|---|---|
| 11 class `ContentPack*` | 75 | 544 s | 43% |
| 19 test dài ≥ 10 s (đa số ContentPack) | 19 | 404 s | 32% (chồng lên dòng trên) |
| 813 test < 0,3 s | 813 | 110 s | 9% |
| Trung vị / p90 / p99 / max | | 0,28 / 1,40 / 19,2 / 38,6 s | |

**Nguyên nhân 1 — ContentPack (đã chứng minh bằng đối chứng):** một test chậm chạy 51 s với CPU người dùng 53,7 s (CPU phía client, không phải DB; 0 câu SQL ≥ 200 ms, 282 kết nối). Đo riêng lệnh import pack thật: `--apply` không có nhóm `blog` (329 hàng) **1,06 s**; `--apply` đủ nhóm (thêm 291 hàng và pipeline ảnh) **20,8 s** (CPU 23,1 s); dry-run 0,85 s; chạy lại khi không còn gì để thêm 0,93 s. Output ghi "picture pipeline gave variants to 40 of 40", 240 biến thể ảnh. Các test ContentPack thường tạo target mới và import lại pack, nên mỗi lần import trả khoảng 20 s CPU. Đây là công việc thật của mã đang được test. *Chưa chắc:* `perf` bị chặn (`perf_event_paranoid=4`) nên không có profile; việc quy cho pipeline ảnh (SkiaSharp) là suy ra bằng loại trừ (sự khác biệt 19,7 s chỉ xuất hiện khi thêm nhóm blog).

**Nguyên nhân 2 — reset database mỗi test (đo trực tiếp một lần, tổng là ước lượng):** `ResetDatabaseAsync` (TRUNCATE 45 bảng CASCADE + 5 lần seed) mất 0,34 s (`fsync` bật) hoặc 0,23 s (tắt) trên NVMe ext4; CPU tiến trình test khoảng 0,3 s mỗi lần. Theo mã nguồn, 55/93 class (khoảng 1150 test) gọi reset mỗi test, nên khoảng 390 s ≈ **31% (ước lượng)**. Trên CI reset chậm hơn (xem §4). Không tách được phần seed riêng vì lần đo của tôi bị lỗi (chạy seed không truncate, trùng khóa), tôi không báo con số đó.

**Đã đo và loại trừ:** khởi động host 0,3 s, băm mật khẩu 60 ms, tạo database + host + migrate 1,5–2,2 s, DB không phải nút thắt (CPU test ≈ wall). Không giả định: dùng pooling hay bỏ seed không được đụng đến.

**Một test lỗi cục bộ, do môi trường:** `ContentPackTests.Export_of_an_imported_database_gives_the_packs_rows_back…` so chuỗi thời gian `+00:00` với `+07:00`. Nó vẫn lỗi với `TZ=UTC` của tiến trình test và **pass khi PostgreSQL server dùng `timezone=UTC`** (như container CI). Vậy test phụ thuộc múi giờ của server PostgreSQL, không phải của tiến trình. Không sửa (ngoài phạm vi).

## 2. Phương án đã chọn và đã loại

**Chọn:** chia integration test theo class vào 4 job (mỗi job một PostgreSQL 18.3 service và một database riêng); test bên trong mỗi job **không đổi**. Job tên `Backend` (check bắt buộc) chuyển thành cổng tổng hợp.

Đã loại: chạy song song trong một job (collection chia sẻ DB/reset/pool/state tĩnh, rủi ro lớn hơn); cache trạng thái sau import ContentPack bằng template database (bỏ qua bước mà hành vi phụ thuộc, cần phân tích từng test); cache restore (restore chỉ 10–38 s; `setup-dotnet` cache cần lock file); tắt `fsync` ở PostgreSQL CI (đã đo cục bộ reset nhanh hơn 32% nhưng chưa chứng minh trên CI, và đã đủ mục tiêu mà không cần; xem §6); bớt hay bỏ qua test (cấm).

## 3. Thay đổi

| File | Mục đích |
|---|---|
| `.github/workflows/ci.yml` | Job `backend-tests` (ma trận 4 shard, mỗi shard restore/build, liệt kê test, chạy phần của mình, upload TRX). Job `Backend` là cổng: `needs`, `if: always()`, tải kết quả, chạy self-test rồi `verify` |
| `Back_End/tests/ci/integration-shards.json` | Class của shard 1–3 (đo theo thời gian từng class). Shard 4 = mọi class chưa nêu tên, nên class mới không bao giờ bị bỏ sót |
| `Back_End/tests/ci/ci_shards.py` | `filter` (biểu thức `dotnet test --filter`), `verify` (cổng), `selftest` (assert) |
| `docs/reports/BHA-CI-FAST-001.md`, `docs/project/SNAPSHOT.md` | Báo cáo và trạng thái |

Không đụng mã nghiệp vụ, API, schema, migration, Front_End, dependency, runner image hay branch protection (đọc: required checks là `Admin`, `Backend`, `Frontend`).

## 4. Trước và sau

| | Trước (CI, run `44589119407`) | Sau lần 1 (CI, run `44724911099`, head `7919991`) | Sau lần 2 (CI, run `44726528001`, head `0ed1648`) |
|---|---|---|---|
| Wall, run tạo → check `Backend` xong | khoảng 26,9 phút (26m31s + 20 s queue) | 578 s (9m38s) | 599 s (9m59s) |
| Restore / Build | 38 s / 50 s | 10–14 s / 36–42 s mỗi shard | 10–22 s / 27–47 s mỗi shard |
| Bước test dài nhất | 24m31s | 480 s (shard 4); 335–365 s các shard kia | 489 s (shard 3, runner chậm); 282–367 s các shard kia |
| Cổng `Backend` | — | 10 s | 10 s |
| Runner-minutes (job Backend) | 26,5 | 30,8 | 29,8 |
| Số test | 1561 + 676 | 1561 + 676 | 1561 + 676 |

Shard 4 (mọi class chưa nêu tên) lâu hơn các shard kia ở lần 1 (426 s so với 331–373 s thời gian test), vì reset database chậm hơn trên runner so với máy đo ban đầu. Lần 2 chọn lại class của shard 1–3 theo thời gian từng class của chính CI run lần 1 (kỳ vọng các shard đều khoảng 356–371 s). Kết quả: **wall 599 s so với 578 s, không khác đáng kể**. Tổng thời gian test gần như nhau (1462 s và 1430 s) nhưng shard 3 ở lần 2 rơi vào một runner chậm (restore 22 s, build 47 s so với 10–14 s và 27–37 s ở các runner khác; thời gian test 484 s thay vì khoảng 356 s kỳ vọng), còn shard 4 chỉ 263 s. Biến thiên giữa các runner (khoảng ±30%) lớn hơn lợi ích của việc cân bằng lại, nên mới hai mẫu không chứng minh được cân bằng lại có ích; thay đổi chỉ là dữ liệu trong JSON và cân bằng kỳ vọng tốt hơn nên được giữ. Wall đo được trong khoảng 578–599 s (9,6–10 phút).

Cục bộ (8 nhân, 4 PostgreSQL chạy đồng thời, không đại diện cho runner): bốn shard mỗi shard 8–9 phút, các shard lệch nhau khoảng 5%. Giảm wall của CI: **khoảng 63–64%** ở cả hai lần (mục tiêu ≥ 30%, hướng < 15 phút: đạt). Runner-minutes tăng khoảng 16% vì restore/build lặp ở mỗi shard (repo public nên không tính phí, nhưng vẫn là tài nguyên).

## 5. Tập test được giữ nguyên (đối chiếu từng tên, không chỉ tổng số)

- **Bộ lọc VSTest thật** (`dotnet test --list-tests --filter`) cho 4 shard: 160 + 313 + 156 + 932 = 1561 và hợp lại bằng đúng danh sách đầy đủ (so sánh multiset, có 10 tên trùng của theory). Cách chia cuối (sau khi cân bằng lại) được kiểm tra bằng mô phỏng bộ lọc trên danh sách thật (mỗi test đúng một shard, 0 test sai); chính cổng `Backend` trên CI kiểm tra lại bằng bộ lọc thật.
- **Cổng `Backend`** so sánh multiset tên test trong các file TRX của mọi shard với `--list-tests` không lọc của từng project (tên TRX và tên liệt kê khớp tuyệt đối, kiểm chứng trên bản chạy 1561 test). Đòi hỏi: mọi shard `success`; mọi test `Passed`; `notExecuted = 0` và `executed = total`; không thiếu, không thừa, không chạy hai lần; các shard dựng cùng một tập test; unit test chạy đúng một lần (chỉ shard 1).
- Cổng chạy trên kết quả thật của 2 cấu hình chia (A: 160/313/156/932; B: nhóm lại hoàn toàn khác 191/230/208/932): đều 1561 + 676, 0 lỗi, 0 skipped.
- **Hành vi khi lỗi**, chứng minh bằng `ci_shards.py selftest` (1 ca đạt, 13 ca lỗi, thêm các assert về bộ lọc; cổng chạy self-test này trước khi tin chính nó) và bằng cách làm hỏng bản sao của kết quả thật: job `failure`, `cancelled`, `skipped`; thiếu file TRX của một shard; thiếu danh sách; test `Failed`; test không thực thi; thiếu một test trong kết quả; một test chạy ở hai shard; các shard dựng khác tập test; thiếu kết quả unit; số shard của workflow khác cấu hình. Tất cả đều làm cổng thất bại; bản đối chứng không sửa vẫn đạt.
- **Phụ thuộc thứ tự/trạng thái:** không đổi reset/seed/fixture. Hai cách chia khác nhau (class đứng cạnh nhau khác nhau) đều pass toàn bộ.
- **`if: always()`**: một check bắt buộc bị skip được GitHub tính là đạt. Job `Backend` luôn chạy khi shard lỗi hoặc bị hủy và chỉ đạt nếu mọi `needs` là `success`.

## 6. Rủi ro, giới hạn và việc tiếp theo

- Shard 4 nhận mọi class mới (các PR huy hiệu sắp tới). Khi nó vượt các shard khác, chuyển một class vào danh sách trong JSON; chỉ cân bằng phụ thuộc file này, độ phủ thì không.
- Workflow chạy hai project test cụ thể; một project test thứ ba trong tương lai phải được thêm vào workflow (trước đây `dotnet test` chạy cả solution).
- Mỗi shard dựng lại (restore/build ≈ 1 phút): wall giảm nhưng tổng runner-minutes tăng.
- Việc tiếp theo, nếu cần nhanh hơn nữa và OC quyết: (a) ContentPack: dùng chung kết quả pipeline ảnh cho các test không kiểm tra pipeline (có thể bớt vài trăm giây) cần phân loại từng test; (b) reset database: giảm TRUNCATE hoặc dùng template database; (c) `fsync=off` cho PostgreSQL CI (`ALTER SYSTEM` + reload sau khi service sẵn sàng; đo cục bộ −32% thời gian reset); (d) một test ContentPack phụ thuộc múi giờ của server PostgreSQL.
- Preflight ghi nhận: hai linked worktree Orca cũ (tháng 8) vẫn tồn tại trên máy, không liên quan, không sử dụng, không sửa (`docs/governance/RULES.md` §5).
- Review `NOT RUN`; Owner gọi.

## 7. Đề xuất cho các task huy hiệu (để OC áp dụng ở MEP sau; chưa sửa test của feature)

- Rà mẫu: 17 test `NewsletterUnseenTests` (PR #136) mất 17,9 s (≈ 1 s/test), mỗi test bảo vệ một rủi ro khác nhau (thứ tự commit, cursor riêng của từng Staff, deadlock/đồng thời, kiểm tra watermark, RBAC và origin, không lộ email/token, 404 menu lạ, rollback trả số, không cache, local gate): không thấy trùng. Test dài nhất nhóm ContentPack (`ContentPackScopeTests.cs:19`, 38,6 s) import pack hai lần và phần "pack can be imported" lặp lại điều các test import đã kiểm tra; chỉ ghi nhận, chưa đề xuất sửa.
- Test theo hành vi công khai và invariant, không theo từng hàm. Unit cho logic thuần (so sánh watermark, nhãn "50+", gom sự kiện); integration cho SQL, transaction, migration, RBAC, đồng thời.
- Mỗi integration test trả khoảng 0,3 s reset: gom các khẳng định cùng một kịch bản và cùng một failure mode vào một test; tách khi failure mode khác nhau.
- Không nhân bản ma trận edge case ở mọi tầng; dùng `[Theory]` khi chỉ đổi dữ liệu và giữ một hợp đồng (ví dụ ma trận quyền theo Property).
- Mỗi regression test gắn với một failure mode có tên; không đặt hạn ngạch test/code. Tránh test import cả content pack nếu không kiểm tra pack.
