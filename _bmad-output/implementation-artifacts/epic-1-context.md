# Epic 1 Context: Từ deck của bạn thành kịch bản hội thoại

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Người dùng chọn một deck từ vựng, một chủ đề và một Trình độ, rồi nhận về một **Kịch bản**
hội thoại hai vai chứa chính những từ mình đang học, kèm giọng bản ngữ đọc mẫu cho mọi lời
thoại và **Thang gợi ý** sinh sẵn cho từng **Lượt**. Epic này đứng một mình đã có giá trị —
người dùng đọc và nghe được, dù chưa luyện nói. Quan trọng hơn, nó gánh hai thay đổi nền
tảng mà toàn bộ Epic 2 và 3 phụ thuộc: **Kịch bản chuyển từ chuỗi markdown sang dữ liệu có
schema**, và **tách lớp nguồn từ vựng** khỏi Anki.

## Stories

- Story 1.1: Nạp từ vựng qua lớp nguồn thay thế được
- Story 1.2: Kịch bản thành dữ liệu có cấu trúc
- Story 1.3: Sinh sẵn thang gợi ý cùng kịch bản
- Story 1.4: Giọng mẫu bản ngữ, sinh một lần và giữ lại

## Requirements & Constraints

**Nạp từ vựng** — Chỉ đọc, không bao giờ ghi ngược vào Anki. Rút từ và nghĩa bất kể deck
dùng tên trường nào (`Front`/`Back`, `Word`/`Meaning`, `English`/`Vietnamese`; tên lạ thì
lấy hai trường đầu), gỡ HTML, loại thẻ thiếu mặt mà không làm hỏng cả lần nạp. Danh sách
deck hiện trong 2 giây khi Anki đang chạy; khi không chạy thì báo nguyên nhân kèm cách khắc
phục, không màn hình trắng.

**Kịch bản** — Trả về dữ liệu có cấu trúc, không phải văn bản tự do: danh sách lượt, mỗi
lượt có vai, câu thoại, và danh sách **Từ mục tiêu** của riêng lượt đó. Từ mục tiêu lấy từ
dữ liệu chứ không dò chuỗi con (`cold` không được khớp nhầm trong `colder`). Giữ 5–12 lời
thoại chia đều hai vai, tối đa 2 Từ mục tiêu mỗi Lượt, tối đa 20 từ mỗi Kịch bản, và mọi
Từ mục tiêu của buổi phải xuất hiện ít nhất một lần. **Trình độ** (A2/B1/B2) chỉ chi phối
ngôn ngữ *ngoài* Từ mục tiêu. Chủ đề và Trình độ đều có giá trị mặc định; chọn xong là sinh
ngay, không thêm bước cấu hình.

**Ràng buộc đặt từ (đã kiểm chứng bằng đo lường)** — Từ mục tiêu kết thúc bằng `-ed`/`-s`/
`-d`/`-t` **không** được đứng ngay trước một từ bắt đầu bằng chính phụ âm đó. Người bản ngữ
vốn không bật âm cuối ở *"walked to"*, *"cold drink"*, nên đặt từ vào đó thì Epic 2 không
chấm được đuôi từ.

**Thang gợi ý** — Sinh trong **cùng lần gọi** với Kịch bản và lưu kèm. Hai nấc theo thứ tự
cố định: (1) tình huống câu đó được dùng — **không chứa bản dịch tiếng Việt** của câu đích,
(2) từ khoá — gồm các Từ mục tiêu và không quá 2 từ nội dung khác. **Không có nấc nào hiện
toàn bộ Câu đích.** Mở gợi ý **không được phát sinh lời gọi mạng nào**.

**Audio mẫu** — Sinh cho mọi lời thoại của cả hai vai, **một lần duy nhất** rồi cache vĩnh
viễn. Mở lại Kịch bản cũ phải phát ngay từ bản lưu, không gọi sinh audio mới. Kho lưu phải
chịu được dung lượng audio — `localStorage` không đủ. Kho đầy hoặc lỗi lưu thì báo rõ và
Kịch bản vẫn dùng được, chỉ mất phần nghe.

**Không đổi hành vi hiện có** — Sau Story 1.1, toàn bộ luồng chọn deck → sinh hội thoại
phải chạy y như trước. Kịch bản cũ dạng markdown trong lịch sử không được làm vỡ app. Sinh
kịch bản thất bại thì báo rõ nguyên nhân, cho thử lại, không mất từ vựng đã nạp.

## Technical Decisions

- **Không có tài liệu Architecture riêng.** Phụ lục PRD đóng vai trò đó. Khoảng trống đã
  biết: chưa có mô hình dữ liệu chính thức — Epic này là nơi định hình nó.
- **Lớp nguồn từ vựng:** kiểu dữ liệu từ vựng nằm ở module trung tính, không nằm trong
  `lib/anki.ts`; tên kiểu không mang dấu vết Anki; trường riêng của Anki là tuỳ chọn; Anki
  là *một* cách hiện thực, không phải đường duy nhất mã hoá cứng. Lý do làm sớm: ràng buộc
  hiện còn nông (kiểu chỉ 4 trường, ~8 file import thuần dưới dạng kiểu) — càng để lâu càng
  đắt. Story này không mang giá trị người dùng trực tiếp, đó là chủ ý.
- **Phân công dịch vụ:** Gemini sinh Kịch bản + nội dung Thang gợi ý (một lần gọi, cache).
  Azure sinh giọng mẫu bản ngữ — cùng key và cùng hoá đơn với phần chấm phát âm ở Epic 2,
  bậc F0 cho sẵn 0,5 triệu ký tự/tháng. `SpeechSynthesis` của trình duyệt miễn phí nhưng
  giọng máy móc, không dùng được cho app dạy phát âm.
- **Lưu trữ:** chuyển audio sang IndexedDB. Đây là tầng lưu trữ mới của dự án; trạng thái
  dạng text nhỏ ở Epic 3 cố ý *không* dùng nó.
- **Chọn từ vựng tạm thời:** Epic 1 và 2 lấy N từ đầu deck. Logic **Thẻ đến hạn** đến ở
  Epic 3 — đây là chỗ duy nhất có "làm rồi sửa", và nó cố ý.
- **Không dùng trường `interval` của Anki**, dù nó đang được lấy sẵn. Đó là lịch ôn cho khả
  năng *nhận ra* từ; sản phẩm này xếp lịch cho khả năng *nói ra*.
- **Chưa gỡ nợ kỹ thuật ở Epic này.** Đường Gemini Live (`/practice` → `VoicePractice.tsx`
  → `useGeminiLive.ts` → `/api/live-token`) giữ nguyên cho đến khi màn hình luyện mới của
  Epic 2 chạy được. `public/audio-processor.worklet.js` không bao giờ xoá.
- **Ràng buộc nền tảng:** AnkiConnect chỉ nghe `localhost` trên desktop, nên giai đoạn này
  phát triển và kiểm thử trên desktop; PWA điện thoại là trạng thái mục tiêu, chưa dựng được.
- Typecheck và lint phải sạch.

## UX & Interaction Patterns

Ba bề mặt liên quan tới Epic này: **Chọn deck** (chỉ khi chưa chọn hoặc muốn đổi), **Chuẩn
bị buổi** (chủ đề, Trình độ, số từ dùng cho buổi), và phần chờ trước khi vào Buổi luyện.

- **Chờ sinh kịch bản (5–15 giây):** kể tiến trình chứ không để vòng xoay câm — *"Đang chọn
  từ… đang viết hội thoại… đang thu giọng mẫu…"*.
- **Anki không chạy:** giữ nguyên cách xử lý hiện có — nêu nguyên nhân kèm hướng dẫn cài
  AnkiConnect và mã addon, có nút thử lại.
- **Giọng sản phẩm:** huấn luyện viên, xưng hô với người dùng là **"Bạn"**, nêu cụ thể thay
  vì khen chung chung. Ví dụ khi không có thẻ đến hạn: *"Hôm nay bạn không có từ nào đến
  hạn. Muốn luyện thêm thì chọn chủ đề bất kỳ."*
- **Thị giác:** xanh lá trầm, hai chế độ sáng/tối người dùng tự gạt trong app (không theo hệ
  điều hành). Một họ chữ Inter, bậc spacing 4px, không dùng thư viện giao diện dựng sẵn.
  Không streak, không huy hiệu, không chuỗi ngày. Token màu và typography đầy đủ nằm trong
  tài liệu DESIGN của UX.

## Cross-Story Dependencies

- **1.1 → 1.2:** kiểu từ vựng trung tính phải có trước khi schema Kịch bản tham chiếu tới
  Từ mục tiêu.
- **1.2 chặn 1.3 và 1.4:** schema của Kịch bản là nơi Thang gợi ý được gắn vào từng Lượt và
  là nơi audio mẫu được neo theo lời thoại. Đây là thay đổi nền tảng — **mọi thứ khác phụ
  thuộc vào nó**, kể cả toàn bộ Epic 2 và 3.
- **1.3 và 1.4 độc lập với nhau**, làm song song được sau khi 1.2 xong.
- **Epic 1 không cần Epic 2 hay 3 để hoàn chỉnh.** Epic 2 cần Kịch bản từ Epic 1. Epic 3
  thay cách chọn từ vựng của Epic 1 bằng logic Thẻ đến hạn.
- **Story 1.4 dựng tầng IndexedDB** mà Epic 2 sẽ dùng lại cho bản ghi âm của người dùng.
