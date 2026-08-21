---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-anki-english-app-2026-08-20/prd.md
  - _bmad-output/planning-artifacts/prds/prd-anki-english-app-2026-08-20/addendum.md
  - _bmad-output/planning-artifacts/briefs/brief-anki-english-app-2026-08-20/brief.md
  - _bmad-output/planning-artifacts/briefs/brief-anki-english-app-2026-08-20/addendum.md
---

# Phòng tập phản xạ tiếng Anh — Bóc tách Epic

## Tổng quan

Tài liệu này bóc yêu cầu từ PRD và phụ lục PRD thành các epic và story triển khai được.

**Lưu ý về đầu vào:** dự án **không có tài liệu Architecture riêng**. Theo quyết định
của người dùng, [phụ lục PRD](prds/prd-anki-english-app-2026-08-20/addendum.md) đóng
vai trò đó — nó chứa cấu hình dịch vụ đã kiểm chứng, ràng buộc định dạng audio, phân
công dịch vụ, và thứ tự gỡ nợ kỹ thuật. **Khoảng trống đã biết:** chưa có mô hình dữ
liệu và quyết định tầng lưu trữ chính thức.

Không có tài liệu UX.

## Kho yêu cầu

### Yêu cầu chức năng

**Nạp từ vựng**
- **FR-1**: Người dùng chọn một deck Anki; hệ thống đọc toàn bộ thẻ trong deck đó.
- **FR-2**: Hệ thống rút từ và nghĩa từ các trường của thẻ bất kể deck dùng tên trường nào; gỡ HTML; loại thẻ thiếu mặt. Chỉ đọc, không ghi ngược vào Anki.

**Màn hình chính**
- **FR-3**: Người dùng thấy danh sách Thẻ đến hạn ngay khi mở app, không cần thao tác nào; khi rỗng vẫn vào được buổi luyện tự do.
- **FR-4**: Với mỗi Từ mục tiêu, hệ thống hiện tổng số Lượt đã kết thúc ở trạng thái Đạt. Lượt có gợi ý vẫn tính; Lượt bị hiện đáp án không tính.

**Sinh kịch bản**
- **FR-5**: Người dùng chọn một chủ đề từ danh sách có sẵn trước khi sinh Kịch bản.
- **FR-6**: Hệ thống sinh Kịch bản 5–12 lời thoại chứa mọi Từ mục tiêu đến hạn, tối đa 2 từ mỗi Lượt, trả về dữ liệu có cấu trúc; **sinh luôn nội dung Thang gợi ý trong cùng lần gọi và cache**; không đặt từ có đuôi `-ed`/`-s`/`-d`/`-t` ngay trước từ bắt đầu bằng chính phụ âm đó.
- **FR-7**: Hệ thống sinh audio mẫu cho mọi lời thoại **một lần** và lưu lại; mở lại Kịch bản cũ không sinh lại.

**Buổi luyện**
- **FR-8**: Hệ thống phát audio và hiện văn bản cho lời thoại vai của nó; **không bao giờ hiện Câu đích** của người dùng trừ khi FR-12 kích hoạt.
- **FR-9**: Người dùng ghi âm Lượt của mình; nghe lại được ngay; bản ghi giữ trên máy.
- **FR-10**: Thang gợi ý hai nấc theo thứ tự cố định — tình huống (không dịch tiếng Việt), rồi từ khoá. **Không có nấc hiện cả câu.** Mở gợi ý không gọi mạng. Độ sâu được ghi lại.
- **FR-11**: Tối đa 3 lần thử mỗi Lượt trong một buổi.
- **FR-12**: Sau 3 lần chưa Đạt, hệ thống hiện Câu đích kèm audio mẫu, ghi Lượt là chưa Đạt, và đánh dấu để lặp ở buổi sau. Người dùng không có nút tự bỏ qua.
- **FR-13**: Người dùng kết thúc buổi bằng một thao tác rõ ràng; số liệu các Lượt đã hoàn thành vẫn được ghi nhận.

**Chấm điểm**
- **FR-14**: Chấm mỗi Lượt ngay trong luồng chat, kết quả trong 3 giây, gắn đúng vị trí; lỗi dịch vụ không chặn buổi luyện.
- **FR-15**: Phân biệt ba tầng lỗi. **Phát hiện tầng 1 và 2 đọc điểm từng âm vị**, không dùng điểm cấp từ cũng không dùng cờ lỗi của dịch vụ. Tầng 1 (Từ mục tiêu) chặn Đạt; tầng 2 (lỗi đặc trưng người Việt) hiện nổi bật nhưng không chặn; tầng 3 (từ chức năng) chỉ trong chi tiết.
- **FR-16**: Nghe lại bản thu cạnh audio mẫu không giới hạn, không gọi dịch vụ chấm, không trừ hạn mức.

**Đo lường**
- **FR-17**: Đo Độ trễ bật câu tại máy từ dạng sóng; **chỉ ghi nhận ở Lượt không mở gợi ý**; Lượt có gợi ý bị bỏ khỏi chuỗi, không ghi giá trị thay thế.
- **FR-18**: Ghi lại độ sâu gợi ý cho từng Lượt — ba trạng thái phân biệt được.

**Tổng kết**
- **FR-19**: Bảng tổng kết sau buổi: số Lượt Đạt trên tổng, Từ mục tiêu Nói ra được lần đầu, Lượt phải hiện đáp án, Độ trễ trung bình so với buổi trước. Khi không đủ dữ liệu độ trễ thì nói rõ, không hiện 0.

**Lịch giãn cách**
- **FR-20**: Xếp lịch Thẻ đến hạn theo bậc cố định **1 → 3 → 7 → 14 ngày** khi Nói ra được; từ bị hiện đáp án quay lại **ngày mai** và về bậc đầu. Một từ không xuất hiện quá một buổi mỗi ngày. Có giới hạn số thẻ mỗi ngày; quá tải thì ưu tiên từ đã trượt. Trạng thái lưu mỗi từ: bậc, ngày đến hạn, số lần Nói ra được, số lần bị hiện đáp án.
- **FR-21**: Từ mục tiêu thuộc Lượt phải hiện đáp án quay lại sớm hơn và dày hơn; việc lặp thêm diễn ra ở **các buổi sau**, không phải bằng cách tăng số lần thử trong buổi hiện tại.

### Yêu cầu phi chức năng

- **NFR-1**: Kết quả chấm hiện trong **3 giây** kể từ khi dừng ghi âm.
- **NFR-2**: Mỗi clip gửi đi chấm **không quá 30 giây** — kéo theo chấm phải theo từng Lượt.
- **NFR-3**: Audio thu ở **PCM 16 kHz, 16-bit, mono**.
- **NFR-4**: Mất mạng giữa buổi **không làm mất** số liệu các Lượt đã hoàn thành.
- **NFR-5**: Kho lưu trữ cục bộ phải **chịu được dung lượng audio** — `localStorage` không đủ.
- **NFR-6**: **Cắt khoảng lặng** đầu/cuối trước khi gửi chấm; dịch vụ tính tiền theo giây.
- **NFR-7**: Audio mẫu và Kịch bản sinh **một lần** rồi dùng lại; không sinh lại khi mở lại.
- **NFR-8**: Nghe lại và tự so sánh chạy **hoàn toàn tại máy**, không phát sinh chi phí.
- **NFR-9**: Giới hạn 3 lần thử mỗi Lượt vừa là ràng buộc sư phạm **vừa là lan can chi phí** — bỏ nó thì mô hình giá vỡ.
- **NFR-10**: Phải **nói rõ với người dùng** rằng giọng nói của họ rời khỏi máy để đi chấm.
- **NFR-11**: Bản ghi của người dùng lưu **tại máy**, không tải lên máy chủ nào để lưu trữ.

### Yêu cầu bổ sung

*(Từ phụ lục PRD — đóng vai trò tài liệu Architecture)*

**Tích hợp dịch vụ chấm phát âm**
- Yêu cầu gửi **bắt buộc** có `Dimension: "Comprehensive"`. Thiếu nó, dịch vụ trả HTTP 200 bình thường nhưng **âm thầm bỏ** `ErrorType`, `FluencyScore`, `CompletenessScore`, `ProsodyScore`.
- REST cho audio ngắn trả điểm **cấu trúc phẳng** trên `NBest[0]` và trên từng từ/âm vị — **khác** Speech SDK. Viết theo hình dạng SDK sẽ ra `undefined` mà không báo lỗi.
- Bậc miễn phí **chỉ 1 request đồng thời**, không nâng được — đủ tự thử, không phục vụ được người dùng thật.

**Đường đi audio**
- `MediaRecorder` cho ra webm/opus, **không dùng được**. Phải thu qua AudioWorklet rồi đóng gói WAV.
- Đã có sẵn: `lib/wav.ts`, `public/audio-processor.worklet.js`.

**Phân công dịch vụ**
- Gemini: sinh Kịch bản, sinh nội dung Thang gợi ý, viết nhận xét tiếng Việt.
- Azure: chấm phát âm **và** giọng mẫu (cùng key, cùng hoá đơn).

**Thay đổi nền tảng trong codebase hiện có**
- `dialogue` hiện là **chuỗi markdown**, không parse tin cậy được — phải đổi sang JSON có schema. **Mọi thứ khác phụ thuộc thay đổi này.**
- Tách lớp `VocabularySource` để sau này thay Anki mà không phải mổ cả app (~8 file, chỉ import kiểu).
- Chuyển lưu trữ sang IndexedDB.

**Nợ kỹ thuật phải gỡ**
- Chuỗi `/practice → VoicePractice.tsx → useGeminiLive.ts → /api/live-token` **chết**, gỡ cả ba **sau khi** có bản thay thế.
- `/api/live-token` **bắt buộc** phải gỡ: nó trả thẳng `GEMINI_API_KEY` về trình duyệt.
- **Không xoá** `public/audio-processor.worklet.js` — hạ tầng ghi âm dùng chung.

**Ràng buộc đã biết**
- AnkiConnect chỉ chạy `localhost` trên desktop → **UJ-1 (điện thoại) chưa dựng được** ở giai đoạn này.
- Ngưỡng âm vị tạm đặt **50**, chưa hiệu chỉnh trên giọng người Việt thật.

### Yêu cầu thiết kế UX

*Không có tài liệu UX. Các câu hỏi mở #3, #4, #5 trong PRD (biểu đồ tiến bộ khi thiếu
dữ liệu, giọng và diện mạo, độ dài buổi luyện) thuộc phạm vi UX và **chưa được trả lời**.*

### Bản đồ phủ yêu cầu

- **FR-1** → Epic 1 — Chọn deck Anki và đọc thẻ
- **FR-2** → Epic 1 — Chuẩn hoá thẻ thành Từ mục tiêu
- **FR-3** → Epic 3 — Màn hình chính hiện Thẻ đến hạn
- **FR-4** → Epic 3 — Đếm số lần Nói ra được cho mỗi từ
- **FR-5** → Epic 1 — Chọn chủ đề
- **FR-6** → Epic 1 — Sinh Kịch bản có cấu trúc, kèm nội dung Thang gợi ý
- **FR-7** → Epic 1 — Sinh và lưu audio mẫu
- **FR-8** → Epic 2 — Hệ thống diễn lượt của nó
- **FR-9** → Epic 2 — Người dùng ghi âm Lượt của mình
- **FR-10** → Epic 2 — Thang gợi ý hai nấc
- **FR-11** → Epic 2 — Giới hạn 3 lần thử mỗi Lượt
- **FR-12** → Epic 2 — Hiện đáp án sau khi thử hết lượt
- **FR-13** → Epic 2 — Kết thúc buổi
- **FR-14** → Epic 2 — Chấm mỗi Lượt ngay trong luồng chat
- **FR-15** → Epic 2 — Phát hiện lỗi theo tầng, đọc điểm âm vị
- **FR-16** → Epic 2 — Nghe lại và tự so sánh
- **FR-17** → Epic 2 — Đo Độ trễ bật câu
- **FR-18** → Epic 2 — Ghi nhận độ sâu gợi ý
- **FR-19** → Epic 2 — Bảng tổng kết buổi
- **FR-20** → Epic 3 — Xếp lịch Thẻ đến hạn theo bậc 1/3/7/14
- **FR-21** → Epic 3 — Ưu tiên Lượt chưa Đạt quay lại sớm

**Phủ: 21/21 yêu cầu chức năng. Không yêu cầu nào bị bỏ sót.**

## Danh sách Epic

### Epic 1: Từ deck của bạn thành kịch bản hội thoại

Người dùng chọn deck Anki và một chủ đề, nhận về đoạn hội thoại chứa chính những từ
mình đang học, kèm giọng bản ngữ đọc mẫu. Đứng một mình đã có giá trị — đọc và nghe
được, dù chưa luyện nói.

**FR phủ:** FR-1, FR-2, FR-5, FR-6, FR-7

**Ghi chú triển khai:** Epic này gánh hai thay đổi nền tảng mà mọi thứ sau phụ thuộc —
**Kịch bản chuyển từ chuỗi markdown sang JSON có schema**, và **tách lớp
`VocabularySource`** để sau này thay Anki mà không phải mổ cả app. Nội dung Thang gợi
ý sinh cùng lần gọi với Kịch bản. Audio mẫu do Azure sinh, cache vĩnh viễn.

### Epic 2: Buổi luyện có chấm điểm ngay

Người dùng nói từng lượt, bí thì mở gợi ý, nói xong được chấm ngay tại chỗ trong luồng
chat, nghe lại đối chiếu với giọng mẫu, và kết thúc buổi bằng bảng tổng kết.

**FR phủ:** FR-8, FR-9, FR-10, FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, FR-17, FR-18, FR-19

**Ghi chú triển khai:** Trái tim sản phẩm, **cố ý giữ nguyên khối** — cả 12 yêu cầu
sống trên cùng một màn hình, tách ra sẽ phải quay lại sửa cùng một chỗ nhiều lần. Phần
đo lường (FR-17, FR-18) nằm trong đây vì đó là đo *trong lúc luyện*. Ghi âm qua
AudioWorklet đóng gói WAV — `MediaRecorder` không dùng được. Chấm điểm bắt buộc gửi
`Dimension: "Comprehensive"` và đọc phản hồi ở **cấu trúc phẳng**. Phát hiện lỗi phải
đọc **điểm từng âm vị**, không dùng điểm cấp từ.

### Epic 3: Luyện đúng từ vào đúng ngày

Mở app là thấy hôm nay cần luyện gì, mỗi từ kèm số lần mình đã nói ra được. Từ nào
trượt thì mai gặp lại. Biến sản phẩm từ công cụ dùng khi nhớ ra thành thói quen hằng ngày.

**FR phủ:** FR-3, FR-4, FR-20, FR-21

**Ghi chú triển khai:** Epic 1 và 2 chọn từ vựng bằng cách đơn giản (lấy N từ đầu trong
deck); Epic này thay bằng logic đến hạn — đó là chỗ duy nhất có "làm rồi sửa", và nó cố
ý. Bậc cố định 1/3/7/14 ngày, không hệ số dễ/khó, không tự điều chỉnh. Trạng thái lưu
mỗi từ: bậc, ngày đến hạn, số lần Nói ra được, số lần bị hiện đáp án.

---

**Kiểm tra phụ thuộc:** Epic 1 không cần Epic 2 để hoàn chỉnh. Epic 2 cần Epic 1 (phải
có Kịch bản) nhưng không cần Epic 3. Epic 3 cần 1 và 2 để có số liệu. Không có mũi tên
nào chỉ ngược.

---

## Epic 1: Từ deck của bạn thành kịch bản hội thoại

Người dùng chọn deck Anki, chủ đề và trình độ, nhận về đoạn hội thoại chứa chính những
từ mình đang học, kèm giọng bản ngữ đọc mẫu và gợi ý sẵn cho từng lượt.

**Đã có sẵn trong codebase, không cần story — chỉ cần xác nhận vẫn chạy:** chọn deck ·
đọc thẻ qua AnkiConnect · gỡ HTML · fallback tên trường lạ · lọc thẻ hỏng · thông báo
lỗi kèm hướng dẫn cài AnkiConnect · chọn chủ đề · chọn trình độ · prompt ràng buộc
5–12 lời thoại và tối đa 2 từ mục tiêu mỗi lượt.

### Story 1.1: Nạp từ vựng qua lớp nguồn thay thế được

As a người xây sản phẩm,
I want truy cập từ vựng qua một lớp trung gian thay vì gọi thẳng Anki,
So that sau này thêm cách nhập từ khác mà không phải mổ lại toàn bộ app.

**Acceptance Criteria:**

**Given** codebase hiện tại
**When** tách xong lớp nguồn
**Then** kiểu dữ liệu từ vựng nằm ở module trung tính, không nằm trong `lib/anki.ts`
**And** tên kiểu không mang dấu vết Anki, trường riêng của Anki là tuỳ chọn
**And** Anki là một cách hiện thực của lớp nguồn, không phải đường duy nhất mã hoá cứng
**And** toàn bộ luồng chọn deck đến sinh hội thoại chạy y như trước, không đổi hành vi
**And** typecheck và lint sạch

*Không có giá trị người dùng trực tiếp — story dọn đường, cố ý làm sớm vì càng để lâu
càng đắt.*

### Story 1.2: Kịch bản thành dữ liệu có cấu trúc

As a người tự học tiếng Anh,
I want hệ thống biết chính xác lượt nào là của tôi và câu đích là gì,
So that nó chấm đúng câu tôi cần nói thay vì dò chuỗi.

**Acceptance Criteria:**

**Given** đã chọn deck, chủ đề và trình độ
**When** sinh kịch bản
**Then** trả về dữ liệu có cấu trúc: danh sách lượt, mỗi lượt có vai, câu thoại, và
danh sách Từ mục tiêu của riêng lượt đó
**And** Từ mục tiêu của mỗi lượt lấy từ dữ liệu, không dò chuỗi con — `cold` không còn
khớp nhầm trong `colder`
**And** Từ mục tiêu có đuôi `-ed`/`-s`/`-d`/`-t` không đứng ngay trước từ bắt đầu bằng
chính phụ âm đó
**And** vẫn giữ 5–12 lời thoại, hai vai, tối đa 2 Từ mục tiêu mỗi lượt, tối đa 20 từ
mỗi kịch bản
**And** Trình độ vẫn chi phối ngôn ngữ ngoài Từ mục tiêu

**Given** kịch bản cũ trong lịch sử ở dạng markdown
**When** người dùng mở lại
**Then** ứng dụng không vỡ

**Given** sinh kịch bản thất bại
**Then** báo rõ nguyên nhân, cho thử lại, không mất từ vựng đã nạp

### Story 1.3: Sinh sẵn thang gợi ý cùng kịch bản

As a người tự học tiếng Anh,
I want mỗi lượt của mình có sẵn gợi ý tình huống và từ khoá,
So that khi bí tôi có đường gỡ mà không phải chờ mạng.

**Acceptance Criteria:**

**Given** hệ thống sinh kịch bản
**Then** mỗi lượt của người dùng kèm hai nấc gợi ý, sinh trong cùng lần gọi
**And** nấc 1 mô tả tình huống câu đó được dùng, không chứa bản dịch tiếng Việt của
câu đích
**And** nấc 2 chứa các Từ mục tiêu và không quá 2 từ nội dung khác
**And** không nấc nào chứa toàn bộ câu đích
**And** gợi ý lưu cùng kịch bản

**Given** người dùng mở một nấc gợi ý
**Then** không phát sinh lời gọi mạng nào

### Story 1.4: Giọng mẫu bản ngữ, sinh một lần và giữ lại

As a người tự học tiếng Anh,
I want nghe giọng bản ngữ đọc mẫu từng lời thoại,
So that tôi có chuẩn để đối chiếu khi luyện.

**Acceptance Criteria:**

**Given** kịch bản vừa được sinh
**Then** audio mẫu được sinh cho mọi lời thoại của cả hai vai

**Given** người dùng mở lại một kịch bản đã có
**Then** audio phát ngay từ bản lưu
**And** không gọi sinh audio mới

**Then** audio lưu ở kho chịu được dung lượng lớn — `localStorage` không đủ

**Given** kho đầy hoặc lỗi lưu
**Then** báo rõ cho người dùng
**And** kịch bản vẫn dùng được, chỉ mất phần nghe

---

## Epic 2: Buổi luyện có chấm điểm ngay

Người dùng đi qua kịch bản từng lượt trong khung chat, nói lượt của mình, bí thì mở
gợi ý, nói xong được chấm ngay tại chỗ, nghe lại đối chiếu giọng mẫu, và kết thúc buổi
bằng bảng tổng kết.

**Đã có sẵn và đã kiểm chứng chạy:** `public/audio-processor.worklet.js` (thu PCM
16 kHz) · `lib/wav.ts` (đóng gói WAV, đo biên độ đỉnh) · `app/api/pronunciation/route.ts`
(chấm Azure, đo thật 1,9 giây) · `app/lab/pronunciation/page.tsx` (nguyên mẫu chạy được
của nửa ghi âm → chấm → hiện điểm âm vị). Toàn bộ đường ống kỹ thuật đã xong; cái thiếu
là màn hình buổi luyện và logic nghiệp vụ.

`components/VoicePractice.tsx` hiện chạy trên Gemini Live — không dùng lại được.

### Story 2.1: Diễn kịch bản theo lượt trong khung chat

As a người tự học tiếng Anh,
I want đi qua hội thoại từng lượt như đang trò chuyện,
So that cảm giác gần với nói thật hơn là làm bài tập.

**Acceptance Criteria:**

**Given** người dùng mở một kịch bản
**When** buổi luyện bắt đầu
**Then** hệ thống phát audio và hiện văn bản lời thoại vai của nó
**And** đến lượt người dùng thì hiện chỗ chờ, không bao giờ hiện Câu đích
**And** nút Kết thúc buổi dùng được ở mọi thời điểm

**Given** người dùng kết thúc giữa chừng
**Then** số liệu các Lượt đã hoàn thành vẫn được giữ

### Story 2.2: Ghi âm lượt của mình và nghe lại cạnh giọng mẫu

As a người tự học tiếng Anh,
I want thu câu mình nói rồi nghe lại ngay cạnh giọng mẫu,
So that tôi tự nghe ra mình khác chỗ nào.

**Acceptance Criteria:**

**Given** đang ở lượt của mình
**When** bấm ghi rồi bấm dừng
**Then** nghe lại được ngay
**And** nghe lại không giới hạn số lần, không gọi dịch vụ chấm, không phát sinh chi phí
**And** bản ghi giữ trên máy **trong suốt buổi luyện**, dùng lại được ở mọi Lượt đã nói
**And** hết buổi thì bản ghi được dọn — *giữ qua nhiều buổi để đối chiếu tiến bộ dài
hạn là việc hoãn lại, không phải bỏ*

**Given** biên độ đỉnh của bản thu quá thấp
**Then** cảnh báo người dùng có thể đang sai micro

### Story 2.3: Chấm điểm ngay trong luồng chat

As a người tự học tiếng Anh,
I want biết mình sai âm nào ngay sau khi nói,
So that tôi sửa được ở lần thử tiếp theo.

**Acceptance Criteria:**

**Given** người dùng vừa dừng ghi âm
**Then** kết quả hiện trong 3 giây, ngay tại Lượt đó, không nhảy màn hình khác
**And** khoảng lặng đầu và cuối được cắt trước khi gửi đi chấm
**And** phát hiện lỗi đọc điểm từng âm vị, không dùng điểm cấp từ, không dùng cờ lỗi
do dịch vụ trả về
**And** tầng 1 (Từ mục tiêu) hiện nổi bật nhất và quyết định trạng thái Đạt: **âm vị
dưới 30 điểm thì Lượt không Đạt**
**And** tầng 2 cảnh báo khi âm vị **dưới 60 điểm** nhưng không chặn Đạt
**And** tầng 2 (nuốt phụ âm cuối, mất đuôi `-s`/`-ed`, giản lược cụm phụ âm) hiện nổi
bật nhưng không chặn Đạt
**And** tầng 3 (từ chức năng) chỉ hiện khi mở phần chi tiết

**Given** dịch vụ chấm trả lỗi
**Then** báo rõ cho người dùng
**And** buổi luyện vẫn đi tiếp được

### Story 2.4: Thang gợi ý hai nấc

As a người tự học tiếng Anh,
I want mở gợi ý khi bí,
So that tôi không bị kẹt mà vẫn phải tự dựng câu.

**Acceptance Criteria:**

**Given** đang ở một Lượt
**When** bấm gợi ý
**Then** hiện nấc 1 là tình huống câu đó được dùng
**And** bấm tiếp hiện nấc 2 là từ khoá
**And** không có nấc nào hiện toàn bộ Câu đích
**And** mở gợi ý không gọi mạng, lấy từ dữ liệu đã lưu cùng kịch bản
**And** hệ thống ghi lại độ sâu gợi ý: không mở, mở tình huống, hoặc mở từ khoá

### Story 2.5: Giới hạn 3 lần thử và hiện đáp án khi hết lượt

As a người tự học tiếng Anh,
I want không bị kẹt vô hạn ở một câu,
So that tôi không bỏ buổi luyện giữa chừng.

**Acceptance Criteria:**

**Given** người dùng đã thử 3 lần mà chưa Đạt
**Then** hệ thống hiện Câu đích kèm audio mẫu, tô rõ âm vị đã hỏng
**And** hiện một **chỉ dẫn nhắm đúng âm vị đó** — nêu tên âm và mẹo cấu âm cho người Việt
**And** chỉ dẫn lấy từ **thư viện văn bản viết sẵn đóng gói theo ứng dụng**, phủ các âm
mà tầng 1 và tầng 2 phát hiện; **không gọi mạng** để sinh
**And** Lượt đó ghi là chưa Đạt, không làm tăng số lần Nói ra được
**And** Từ mục tiêu trong Lượt được đánh dấu để lặp ở các buổi sau
**And** người dùng đi tiếp được

*Story này bao cả việc **viết thư viện chỉ dẫn** (~15–20 mục theo âm vị) lẫn phần hiển
thị. Tách đôi sẽ tạo ra một story không mang giá trị người dùng nào.*

*Story này chỉ **ghi** dấu; phần đọc dấu để xếp lịch nằm ở Epic 3. Không chờ Epic 3 mới
làm được story này.*

**Given** người dùng chưa thử đủ 3 lần
**Then** không có nút tự bỏ qua

### Story 2.6: Đo độ trễ bật câu

As a người tự học tiếng Anh,
I want biết mình mất bao lâu mới bật ra được câu,
So that tôi thấy phản xạ của mình nhanh dần.

**Acceptance Criteria:**

**Given** một Lượt mà người dùng không mở Thang gợi ý
**Then** hệ thống đo từ lúc hiện Lượt đến âm đầu tiên vượt ngưỡng
**And** đo tại máy từ dạng sóng, không gọi dịch vụ ngoài

**Given** một Lượt có mở Thang gợi ý
**Then** Lượt đó bị bỏ khỏi chuỗi số liệu
**And** không ghi giá trị thay thế

### Story 2.7: Bảng tổng kết cuối buổi

As a người tự học tiếng Anh,
I want xem buổi vừa rồi nói lên điều gì,
So that tôi biết mình có tiến bộ không.

**Acceptance Criteria:**

**Given** người dùng kết thúc buổi
**Then** hiện số Lượt Đạt trên tổng số
**And** hiện Từ mục tiêu nào Nói ra được lần đầu
**And** hiện Lượt nào phải hiện đáp án
**And** hiện Độ trễ bật câu trung bình so với buổi trước

**Given** cả buổi không có Lượt nào không-gợi-ý
**Then** phần độ trễ nói rõ chưa đủ dữ liệu, không hiện số 0 hay bỏ trống

### Story 2.8: Gỡ đường Gemini Live và bịt lỗ API key

As a người xây sản phẩm,
I want xoá đường luyện tập cũ sau khi bản mới chạy,
So that không còn API key lộ ra trình duyệt và không ai đi nhầm đường.

**Acceptance Criteria:**

**Given** màn hình luyện mới đã chạy được
**When** gỡ nợ kỹ thuật
**Then** xoá `hooks/useGeminiLive.ts`, `components/VoicePractice.tsx`,
`app/api/live-token/route.ts`
**And** giữ nguyên `public/audio-processor.worklet.js`
**And** `GEMINI_API_KEY` không còn đường nào lọt về trình duyệt
**And** cập nhật `AGENTS.md`, bỏ mục nói lỗ hổng này là cố ý
**And** typecheck, lint và build đều sạch

---

## Epic 3: Luyện đúng từ vào đúng ngày

Mở app là thấy hôm nay cần luyện gì, mỗi từ kèm số lần đã nói ra được. Từ nào trượt
thì mai gặp lại. Biến sản phẩm từ công cụ dùng khi nhớ ra thành thói quen hằng ngày.

**Trạng thái codebase:** gần như làm mới hoàn toàn — không có logic lịch nào tồn tại.
`lib/history.ts` lưu cả mảng thẻ theo từng buổi, không có trạng thái theo từ.

**Cảnh báo:** `lib/anki.ts` đang lấy sẵn trường `interval` của Anki. **Không dùng nó** —
đó là lịch ôn cho khả năng *nhận ra* từ, còn ta xếp lịch cho khả năng *nói ra*. Lẫn lộn
hai thứ sẽ phá ranh giới "không cạnh tranh Anki".

### Story 3.1: Trạng thái luyện tập cho từng từ

As a người tự học tiếng Anh,
I want app nhớ tôi đã nói được từ nào bao nhiêu lần,
So that tiến bộ của tôi không biến mất sau mỗi buổi.

**Acceptance Criteria:**

**Given** người dùng kết thúc một buổi
**Then** với mỗi Từ mục tiêu, hệ thống lưu bậc hiện tại, ngày đến hạn, số lần Nói ra
được, và số lần bị hiện đáp án
**And** chỉ Lượt Đạt làm tăng số lần Nói ra được
**And** Lượt có mở Thang gợi ý vẫn tính
**And** Lượt bị hiện đáp án không tính
**And** trạng thái tồn tại qua các lần đóng mở app

**Given** một Từ mục tiêu chưa từng luyện
**Then** khởi tạo ở bậc đầu và đến hạn ngay

*Trạng thái này nhỏ và toàn text — không cần IndexedDB, khác với audio ở Story 1.4.*

### Story 3.2: Lịch giãn cách 1/3/7/14

As a người tự học tiếng Anh,
I want từ đã nói được thì giãn ra, từ còn yếu thì gặp lại sớm,
So that tôi không phí thời gian ôn thứ mình đã thạo.

**Acceptance Criteria:**

**Given** một Từ mục tiêu kết thúc buổi ở trạng thái Nói ra được
**Then** bậc tăng một nấc
**And** ngày đến hạn tính theo bậc mới: 1, 3, 7, rồi 14 ngày
**And** từ đang ở bậc cuối giữ nguyên 14 ngày, không tăng tiếp

**Given** một Từ mục tiêu thuộc Lượt phải hiện đáp án
**Then** đến hạn vào ngày mai
**And** bậc về lại mốc đầu

**Then** không có hệ số dễ/khó và không tự điều chỉnh — bốn bậc cố định
**And** cùng một Từ mục tiêu không xuất hiện quá một buổi trong cùng một ngày

### Story 3.3: Buổi luyện lấy từ đến hạn

As a người tự học tiếng Anh,
I want kịch bản dựng từ đúng những từ hôm nay cần luyện,
So that mỗi buổi phục vụ đúng chỗ tôi đang yếu.

**Acceptance Criteria:**

**Given** người dùng vào buổi luyện
**Then** kịch bản sinh từ tập Thẻ đến hạn, không còn lấy N từ đầu deck
**And** tối đa 20 từ mỗi buổi

**Given** số Thẻ đến hạn nhiều hơn 20
**Then** ưu tiên từ đã từng trượt trước từ chưa bao giờ trượt

**Given** không có thẻ nào đến hạn
**Then** vẫn vào được buổi luyện tự do, lấy từ bất kỳ trong deck

### Story 3.4: Màn hình chính hiện thẻ đến hạn hôm nay

As a người tự học tiếng Anh,
I want mở app là thấy ngay hôm nay cần luyện gì,
So that tôi bắt đầu được mà không phải nghĩ.

**Acceptance Criteria:**

**Given** người dùng mở app
**Then** danh sách Thẻ đến hạn hiện ngay, không cần thao tác nào
**And** mỗi mục hiện từ, nghĩa, và số lần đã Nói ra được

**Given** không có thẻ nào đến hạn
**Then** màn hình nói rõ điều đó
**And** vẫn cho vào buổi luyện tự do

**Then** vào được buổi luyện bằng một lần chạm từ màn hình này

*Đây là chỗ thay đổi luồng, không chỉ thêm màn hình: hiện tại vào app là "chọn deck →
sinh hội thoại", sau story này là "mở app → thấy việc hôm nay → luyện".*
