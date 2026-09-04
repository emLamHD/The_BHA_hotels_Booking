# THE BHA — `bha-sync`

> Hợp đồng vận hành của `tools/bha-sync/bha-sync.sh`.
>
> `docs/governance/RULES.md` vẫn là thẩm quyền cao nhất; file này chỉ mô tả
> một cơ chế kiểm chứng, không cấp thêm quyền cho bất kỳ agent nào.

## 1. Vấn đề mà `bha-sync` giải quyết

`docs/project/SNAPSHOT.md` là "trạng thái hiện tại có thể phục hồi"
(`RULES.md` §8) và là baseline mà Control Tower cùng `ACTIVE_EXECUTOR` nạp
để lập kế hoạch (`WORKFLOW.md` §2). Nó được duy trì thủ công, nên nó có thể
tụt lại sau GitHub.

Đó chính là điều đã xảy ra với PR #41: PR đã merge vào `develop`
(`2026-09-03T03:11:21Z`, merge commit `e0f5a39`), nhưng Snapshot vẫn mô tả
nó là **Draft, OPEN, chưa merge**, và vẫn ghi `develop` HEAD là
`ff9d5b0` — baseline của PR trước đó. Một agent lập kế hoạch trên văn bản
đó đang lập kế hoạch trên một baseline không tồn tại.

Root cause không phải là một lỗi đánh máy. Snapshot mô tả trạng thái
pre-merge được viết **trước** thời điểm merge, và trong quy trình hiện có
không có bước bắt buộc nào đọc lại GitHub sau khi Owner merge để đối chiếu.
Drift là kết quả có cấu trúc, không phải sơ suất cá biệt, nên biện pháp
khắc phục cũng phải có cấu trúc.

## 2. Bất biến

- **GitHub live state là nguồn sự thật cho trạng thái Pull Request.**
  Snapshot là claim; GitHub là fact. Khi hai bên mâu thuẫn, GitHub thắng.
- **Không suy diễn.** Tên branch local, lịch sử git local, hay chính văn bản
  Snapshot đều không phải bằng chứng cho trạng thái của một remote PR.
- **Fail closed.** Không đọc được GitHub nghĩa là *chưa xác minh*, không
  phải *đã đồng bộ*.
- **Không tự ghi.** `bha-sync` không bao giờ sửa `SNAPSHOT.md` hay bất kỳ
  file tracked nào, và không bao giờ chạm tới remote.

Bất biến cuối cùng là có chủ đích. Một correction phải đi qua feature branch
và PR như mọi thay đổi khác, để nó được review; và vì công cụ không có
đường ghi nào, nó **không thể** đẩy correction thẳng vào một protected
branch. Điều này cũng làm tính idempotent trở thành thuộc tính cấu trúc chứ
không phải thứ phải đi kiểm tra: chạy lại nhiều lần không thể tạo diff khi
không tồn tại code path nào ghi file. Vì vậy công cụ cũng không ghi
timestamp động vào bất kỳ đâu.

## 3. Mapping trạng thái Pull Request

| GitHub | Trạng thái canonical |
|---|---|
| `state=OPEN`, `isDraft=true` | `DRAFT` |
| `state=OPEN`, `isDraft=false` | `OPEN` |
| `state=CLOSED`, chưa merge | `CLOSED` |
| `state=MERGED`, hoặc có `mergedAt` | `MERGED` |
| bất kỳ tổ hợp nào khác | `UNKNOWN` → coi như chưa xác minh |

Claim tương ứng được đọc từ đúng các dòng `| PR #N | ... |` trong §1 của
Snapshot — không đọc từ prose ở nơi khác. Một dòng có nêu ``merge commit
`<sha>` `` là claim `MERGED`; nếu không, `Draft` → `DRAFT`, `OPEN` → `OPEN`.
Dòng không khớp mẫu nào trả về `UNKNOWN` và được xử lý như drift, **không**
được mặc định coi là khớp.

Với mỗi claim `MERGED`, `bha-sync` kiểm tra thêm:

- merge commit trong Snapshot khớp `mergeCommit.oid` trên GitHub;
- `mergedAt` trong Snapshot khớp `mergedAt` trên GitHub;
- merge commit thực sự là ancestor của base ref (mặc định `origin/develop`).

Ngoài các dòng PR, dòng `` | `develop` HEAD | `<sha>` | `` được đối chiếu
với `git rev-parse origin/develop`.

## 4. Kết quả

| Exit | Trạng thái | Ý nghĩa với caller |
|---|---|---|
| `0` | `SYNCHRONIZED` | Baseline dùng được để lập kế hoạch. |
| `2` | `USAGE` | Sai cách gọi. |
| `3` | `DRIFT_DETECTED` | Snapshot mâu thuẫn GitHub. **Baseline không dùng được.** |
| `4` | `SYNC_UNVERIFIED` | Không xác minh được. **Baseline không dùng được.** |

`3` và `4` đều chặn công việc như nhau; chúng tách biệt chỉ để caller phân
biệt "tài liệu sai" với "không kiểm tra được".

`SYNC_UNVERIFIED` có độ ưu tiên cao hơn `DRIFT_DETECTED`: một lượt chạy
không xác minh được có thể đang che giấu drift mà nó chưa kịp nhìn tới.

## 5. Nghĩa vụ của agent

Khi kết quả **không** phải `SYNCHRONIZED`, agent phải:

1. dừng, không dùng `SNAPSHOT.md` làm planning baseline;
2. không tiếp tục planning hoặc implementation trên baseline đó;
3. báo chính xác field nào drift, kèm giá trị snapshot và giá trị GitHub;
4. yêu cầu — hoặc, khi Master Execution Prompt cho phép, thực hiện — một
   canonical correction qua feature branch + PR hợp lệ;
5. không đẩy correction trực tiếp vào `develop` hay `main`;
6. với `SYNC_UNVERIFIED`: không sửa Snapshot bằng suy luận, và không tự
   xin thêm quyền hay token mới.

Quyền merge correction đó vẫn thuộc về Owner (`RULES.md` §7).

## 6. Điểm gọi bắt buộc

Xem `docs/governance/WORKFLOW.md` §2 và §13. Tóm tắt:

- trước khi bất kỳ agent nào dùng `SNAPSHOT.md` làm planning baseline;
- trong post-merge closeout, hoặc ở đầu phiên kế tiếp nếu closeout chưa chạy.

## 7. Cách chạy

```bash
tools/bha-sync/bha-sync.sh                 # mặc định: SNAPSHOT.md + origin/develop
tools/bha-sync/bha-sync.sh --json          # kết quả machine-readable
tools/bha-sync/tests/run-tests.sh          # regression harness
```

Chạy `git fetch --prune origin` trước, nếu không base ref cục bộ có thể tự
nó đã cũ. `bha-sync` không tự fetch: fetch là mutation lên local ref store
và thuộc quyền quyết định của người gọi.

Yêu cầu: `git`, `bash`, và `gh` đã authenticate với quyền đọc repository.

## 8. Giới hạn đã biết

- Chỉ kiểm tra trạng thái Pull Request và `develop` HEAD. Nó **không** xác
  minh phần prose khác của Snapshot, work-item status, hay kết quả CI.
  `SYNCHRONIZED` nghĩa là các claim kiểm chứng được đều đúng, không phải
  toàn bộ tài liệu đều đúng.
- Nó đọc claim theo hình dạng bảng §1 hiện tại. Nếu bảng đó được đổi cấu
  trúc, `bha-sync` trả về `SYNC_UNVERIFIED` thay vì đoán — cố ý fail closed.
- Regression harness dùng một `gh` stub, nên nó kiểm chứng logic parse/so
  sánh/fail-closed của `bha-sync`, không kiểm chứng chính `gh`.
