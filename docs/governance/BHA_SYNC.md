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
nó là **Draft, OPEN, chưa merge**. Một agent lập kế hoạch trên văn bản đó
đang lập kế hoạch trên một baseline không tồn tại.

Root cause không phải là một lỗi đánh máy. Mô tả pre-merge được viết
**trước** thời điểm merge, và trong quy trình khi đó không có bước bắt buộc
nào đọc lại GitHub sau khi Owner merge. Drift là kết quả có cấu trúc, nên
biện pháp khắc phục cũng phải có cấu trúc.

## 2. Bất biến

- **GitHub live state là nguồn sự thật cho trạng thái Pull Request.**
  Snapshot là claim; GitHub là fact. Khi hai bên mâu thuẫn, GitHub thắng.
- **Không suy diễn.** Tên branch local, lịch sử git local, hay văn bản
  Snapshot ngoài canonical block đều không phải bằng chứng cho trạng thái
  của một remote PR.
- **Fail closed.** Không đọc được, không parse được, hoặc dữ liệu tự mâu
  thuẫn đều là *chưa xác minh*, không phải *đã đồng bộ*.
- **Không tự ghi.** `bha-sync` không sửa `SNAPSHOT.md` hay bất kỳ file
  tracked nào, và không chạm tới remote.

Bất biến cuối cùng là có chủ đích. Correction phải đi qua feature branch và
PR như mọi thay đổi khác, để nó được review; và vì công cụ không có đường
ghi nào, nó **không thể** đẩy correction thẳng vào một protected branch.
Điều này cũng làm tính idempotent trở thành thuộc tính cấu trúc chứ không
phải thứ phải đi kiểm tra: chạy lại nhiều lần không thể tạo diff khi không
tồn tại code path nào ghi file. Vì vậy công cụ cũng không ghi timestamp động
vào bất kỳ đâu.

## 3. Mô hình checkpoint — ancestor, không phải bằng nhau

Snapshot ghi `develop-checkpoint`: **checkpoint đã reconcile lần cuối**.

Nó **không** khẳng định mình bằng `develop` HEAD hiện tại. Ràng buộc bằng
nhau là bất khả thi: merge chính commit cập nhật Snapshot sẽ tạo ra một
`develop` HEAD mới, khác với SHA mà commit đó vừa ghi — nên mỗi lần
reconcile sẽ lập tức drift lại và cần thêm một PR nữa, vô hạn.

Bất biến đúng:

- Live HEAD dùng để lập kế hoạch **luôn lấy từ Git** sau một lần fetch
  thành công, không lấy từ Snapshot.
- `develop-checkpoint` phải là một commit hợp lệ và là **ancestor** của live
  HEAD đó.
- Bằng nhau được phép nhưng không bắt buộc.
- Live HEAD là descendant hợp lệ thì **không** phải drift.
- Checkpoint sai định dạng, thiếu, hoặc không xác minh được →
  `SYNC_UNVERIFIED`.
- Checkpoint tồn tại nhưng không phải ancestor của live `develop` →
  `DRIFT_DETECTED`.

Hệ quả: sau khi một PR reconcile được squash-merge, `develop` HEAD mới khác
checkpoint đã ghi, checkpoint vẫn là ancestor của nó, và `bha-sync` vẫn trả
`SYNCHRONIZED`. Không cần PR tiếp theo chỉ để thay checkpoint bằng merge SHA.

## 4. Canonical block — nguồn duy nhất trong Snapshot

`bha-sync` **chỉ** đọc khối được đánh dấu trong `SNAPSHOT.md` §1.1:

```markdown
<!-- BHA-SYNC:BEGIN ... -->

| Canonical field | Giá trị |
|---|---|
| repository | `owner/name` |
| base-branch | `develop` |
| develop-checkpoint | `<40-hex sha>` |

| PR | Base | Lifecycle | Merge commit | Merged at |
|---|---|---|---|---|
| 41 | `develop` | `MERGED` | `<40-hex sha>` | `2026-09-03T03:11:21Z` |

<!-- BHA-SYNC:END -->
```

Khối được đọc bằng một state machine `BEFORE → INSIDE → AFTER` có ràng buộc
section, không phải bằng cách đếm marker. Đếm marker từng chấp nhận một `END`
đứng trước `BEGIN`, một khối không bao giờ đóng, và — nghiêm trọng nhất — một
khối đúng dạng nằm trong section lịch sử, khiến prose có thể thỏa mãn canonical
contract.

Quy tắc cấu trúc — vi phạm bất kỳ điều nào → `SYNC_UNVERIFIED`:

- đúng **một** heading `### 1.1 Canonical record`;
- mọi marker `BHA-SYNC` phải nằm **trong** section đó; marker ở §9 hay bất kỳ
  section lịch sử nào đều bị từ chối;
- `BEGIN` chỉ hợp lệ từ trạng thái `BEFORE`; `END` chỉ hợp lệ từ `INSIDE`;
  chuỗi chuyển trạng thái phải đúng `BEFORE → INSIDE → AFTER`;
- `END` trước `BEGIN`, `BEGIN` lồng nhau, `BEGIN`/`END` lặp lại, khối không
  đóng khi hết file, hoặc không có `BEGIN` nào — đều bị từ chối;
- marker `BHA-SYNC` không nhận dạng được → từ chối;
- đúng **một** dòng `repository`, **một** `base-branch`, **một**
  `develop-checkpoint`;
- mỗi dòng PR đúng **5** trường; số PR phải **duy nhất** — dòng trùng bị từ
  chối, không phải bị `sort -u` hay `grep -m1` giấu đi;
- lifecycle ∈ `MERGED` / `OPEN` / `DRAFT` / `CLOSED`;
- dòng `MERGED` phải có merge commit 40-hex và `mergedAt` ISO-8601; dòng
  không phải `MERGED` phải để cả hai là `—` (null marker của Snapshot);
- mọi dòng không rỗng trong khối phải là dòng bảng.

§1.2 (PR context) và mọi bảng/prose lịch sử khác **nằm ngoài** khối này. Chúng
không thể làm thỏa mãn, cũng không thể làm mất hiệu lực, một canonical row.
Snapshot chỉ có **một** nguồn trạng thái, không có shadow source song song.

Khối canonical cố ý không liệt kê PR remediation của chính bản Snapshot đó —
một PR ghi lifecycle của chính nó sẽ tự drift ngay khi được merge.

## 5. Đọc GitHub live state

`bha-sync` gọi, cho mỗi PR:

```
gh pr view <N> --repo <slug> \
   --json state,isDraft,mergedAt,mergeCommit,baseRefName,url \
   --jq '<one field per line, null → @@NULL@@>'
```

Kết quả là **một trường trên một dòng**, với sentinel `@@NULL@@` cho null.
Đây không phải lựa chọn thẩm mỹ: định dạng TSV trước đây bị hỏng vì tab là
một ký tự **IFS whitespace**, nên các tab liên tiếp của merge fields rỗng bị
gộp lại, đẩy lệch toàn bộ cột phía sau, và mọi PR chưa merge bị phân loại
nhầm thành `MERGED`.

Xác thực bắt buộc cho mỗi PR (vi phạm → `SYNC_UNVERIFIED`):

- đúng **6** trường;
- `state` ∈ `OPEN` / `CLOSED` / `MERGED`;
- `isDraft` là boolean thật (`true`/`false`);
- `baseRefName` có mặt và không rỗng;
- `url` có mặt và trỏ đúng `<slug>/pull/<N>`;
- merge fields nhất quán với state.

Mapping lifecycle:

| GitHub | Canonical |
|---|---|
| `OPEN` + `isDraft=true` + merge fields null | `DRAFT` |
| `OPEN` + `isDraft=false` + merge fields null | `OPEN` |
| `CLOSED` + merge fields null | `CLOSED` (giữ nguyên dù `isDraft` là gì) |
| `MERGED` + `isDraft=false` + `mergedAt` hợp lệ + merge commit hợp lệ | `MERGED` |

Dữ liệu mâu thuẫn **không được đoán** — tất cả đều trả `SYNC_UNVERIFIED`:
`OPEN` mà có merge commit; `MERGED` mà thiếu `mergedAt`; `MERGED` mà thiếu
merge commit; **`MERGED` mà `isDraft=true`** (GitHub không merge một draft, nên
thấy cả hai nghĩa là response không đáng tin); state enum lạ; thiếu `isDraft`.

## 6. Xác thực base branch

Cả canonical `base-branch` lẫn `baseRefName` sống đều được **kiểm tra cú pháp
trước khi so sánh** hoặc trước khi được dùng như một revision. Dữ liệu API sai
định dạng là lỗi xác minh, **không** phải bất đồng thực tế, nên nó không bao giờ
bị xếp thành drift. Guard chạy trong bash trước (từ chối giá trị rỗng, giá trị
bắt đầu bằng `-` để không bao giờ trở thành option của git, và cú pháp revision
`@{...}` mà `git check-ref-format` vẫn chấp nhận), rồi mới tới
`git check-ref-format --branch`.

Với mỗi PR được theo dõi:

- thiếu hoặc sai định dạng (canonical hoặc live) → `SYNC_UNVERIFIED`;
- hợp lệ nhưng khác canonical `base-branch` → `DRIFT_DETECTED`;
- ancestry của merge commit chỉ được kiểm tra **sau khi** base đã khớp, và
  kiểm tra trên đúng base ref đã xác minh (`origin/<base-branch>`, hoặc
  `--base-ref`). Không kiểm tra ancestry trên một ref do caller cung cấp
  trong khi bỏ qua base thật trên GitHub.

## 7. Hợp đồng exit code

| Exit | Trạng thái | Ý nghĩa với caller |
|---|---|---|
| `0` | `SYNCHRONIZED` | Baseline dùng được để lập kế hoạch. |
| `2` | `USAGE_ERROR` | Sai cách gọi (kể cả option thiếu giá trị). |
| `3` | `DRIFT_DETECTED` | Snapshot mâu thuẫn GitHub. **Baseline không dùng được.** |
| `4` | `SYNC_UNVERIFIED` | Không xác minh được. **Baseline không dùng được.** |

`3` và `4` đều chặn công việc như nhau; chúng tách biệt chỉ để caller phân
biệt "tài liệu sai" với "không kiểm tra được". `SYNC_UNVERIFIED` có độ ưu
tiên cao hơn `DRIFT_DETECTED`: một lượt chạy không xác minh được có thể đang
che giấu drift mà nó chưa kịp nhìn tới.

Option thiếu giá trị (ví dụ `bha-sync.sh --snapshot`) được phát hiện **trước**
mọi `shift`, in usage error và trả đúng `2` — không bao giờ kết thúc bằng một
exit code tình cờ của shell. Lỗi môi trường/dependency luôn trả `4`.

## 8. Yêu cầu môi trường

Production path chỉ dùng: **bash >= 4.0** (`mapfile`, `${var,,}`), **`git`**,
và **`gh`** đã authenticate với quyền đọc repository. Không có external command
nào khác — kể cả `cat`: `usage()` in bằng `printf` builtin, vì một heredoc `cat`
sẽ là một binary ngoài không nằm trong hợp đồng này. Cả ba dependency đều được
kiểm tra tường minh khi khởi động; thiếu bất kỳ cái nào → `SYNC_UNVERIFIED`
(`4`). Regression harness chạy `--help` và một usage error với PATH không có
`cat` để giữ điều này đúng.

## 9. Nghĩa vụ của agent

Khi kết quả **không** phải `SYNCHRONIZED`, agent phải:

1. dừng, không dùng `SNAPSHOT.md` làm planning baseline;
2. không tiếp tục planning hoặc implementation trên baseline đó;
3. báo chính xác field nào drift, kèm giá trị snapshot và giá trị GitHub;
4. yêu cầu — hoặc, khi Master Execution Prompt cho phép, thực hiện — một
   canonical correction qua feature branch + PR hợp lệ;
5. không đẩy correction trực tiếp vào `develop` hay `main`;
6. với `SYNC_UNVERIFIED`: không sửa Snapshot bằng suy luận, và không tự xin
   thêm quyền hay token mới.

Quyền merge correction đó vẫn thuộc về Owner (`RULES.md` §7).

## 10. Điểm gọi bắt buộc

Xem `docs/governance/WORKFLOW.md` §2 và §13. Tóm tắt:

- trước khi bất kỳ agent nào dùng `SNAPSHOT.md` làm planning baseline;
- trong post-merge closeout, hoặc ở đầu phiên kế tiếp nếu closeout chưa chạy.

## 11. Cách chạy

```bash
tools/bha-sync/bha-sync.sh                 # mặc định: SNAPSHOT.md + origin/<base-branch>
tools/bha-sync/bha-sync.sh --json          # kết quả machine-readable
tools/bha-sync/tests/run-tests.sh          # regression harness
```

Chạy `git fetch --prune origin` trước, nếu không base ref cục bộ có thể tự nó
đã cũ. `bha-sync` không tự fetch: fetch là mutation lên local ref store và
thuộc quyền quyết định của người gọi.

## 12. Giới hạn đã biết

- Chỉ kiểm tra canonical block: repository, base branch, checkpoint ancestry,
  và lifecycle/base/merge-evidence của các PR được liệt kê. Nó **không** xác
  minh phần prose khác của Snapshot, work-item status, hay kết quả CI.
  `SYNCHRONIZED` nghĩa là các claim kiểm chứng được đều đúng, không phải toàn
  bộ tài liệu đều đúng.
- Nó chỉ hiểu cấu trúc canonical mô tả ở §4. Đổi cấu trúc đó mà không cập
  nhật parser sẽ cho `SYNC_UNVERIFIED` — cố ý fail closed thay vì đoán.
- Regression harness dùng một `gh` stub (có kiểm tra đúng hình dạng tham số
  mà production gửi đi), nên nó kiểm chứng logic parse/validate/so sánh của
  `bha-sync`, không kiểm chứng chính `gh`.
