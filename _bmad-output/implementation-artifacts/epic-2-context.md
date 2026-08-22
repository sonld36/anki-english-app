# Epic 2 Context: Buổi luyện có chấm điểm ngay

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Người dùng đi qua **Kịch bản** của Epic 1 từng **Lượt** một trong khung chat: hệ thống diễn
lượt của vai nó, người dùng nói **Lượt** của mình, bí thì mở **Thang gợi ý**, nói xong được
chấm phát âm ngay tại chỗ, nghe lại đối chiếu giọng mẫu, và kết thúc buổi bằng bảng tổng
kết. Đây là trái tim sản phẩm và **cố ý giữ nguyên khối** — cả mười hai yêu cầu sống trên
cùng một màn hình, tách nhỏ sẽ phải quay lại sửa cùng một chỗ nhiều lần. Epic này cũng là
nơi hai chỉ số sản phẩm sống bằng được sinh ra (**Độ trễ bật câu** và độ sâu gợi ý), và là
nơi đường Gemini Live cũ được gỡ sau khi bản thay thế chạy được.

## Stories

- Story 2.1: Diễn kịch bản theo lượt trong khung chat
- Story 2.2: Ghi âm lượt của mình và nghe lại cạnh giọng mẫu
- Story 2.3: Chấm điểm ngay trong luồng chat
- Story 2.4: Thang gợi ý hai nấc
- Story 2.5: Giới hạn 3 lần thử và hiện đáp án khi hết lượt
- Story 2.6: Đo độ trễ bật câu
- Story 2.7: Bảng tổng kết cuối buổi
- Story 2.8: Gỡ đường Gemini Live và bịt lỗ API key

## Requirements & Constraints

**Diễn kịch bản** — Hệ thống phát audio mẫu và hiện văn bản cho lời thoại vai nó. **Câu
đích** của người dùng **không bao giờ** hiện, trừ đúng một trường hợp: đã thử hết 3 lần mà
chưa Đạt. Nút Kết thúc buổi dùng được ở mọi thời điểm; kết thúc giữa chừng vẫn giữ số liệu
các Lượt đã hoàn thành. Không bắt người dùng nói lời chào để thoát.

**Ghi âm và nghe lại** — Thu **PCM 16 kHz, 16-bit, mono** trong container WAV. Bấm để bắt
đầu, bấm lần nữa để dừng — không phải giữ nút. Nghe lại **không giới hạn**, chạy hoàn toàn
tại máy, không gọi dịch vụ chấm, không trừ hạn mức. Bản ghi giữ trên máy **trong suốt một
buổi** và dùng lại được ở mọi Lượt đã nói; hết buổi thì dọn. Giữ qua nhiều buổi là **hoãn,
không bỏ** — đừng thiết kế theo hướng bịt đường quay lại. Bản ghi không tải lên máy chủ nào
để lưu trữ, và phải **nói rõ với người dùng** rằng giọng của họ rời khỏi máy để đi chấm.
Biên độ đỉnh quá thấp thì cảnh báo có thể đang sai micro.

**Chấm điểm** — Kết quả hiện trong **3 giây** kể từ khi dừng ghi, ngay tại Lượt đó, không
nhảy màn hình. **Cắt khoảng lặng** đầu/cuối trước khi gửi (tính tiền theo giây) và mỗi clip
tối đa **30 giây** — đó là lý do phải chấm theo từng Lượt. Ba tầng lỗi: tầng 1 (**Từ mục
tiêu**) hiện nổi bật nhất và quyết định **Đạt**; tầng 2 (nuốt phụ âm cuối, mất đuôi `-s`/
`-ed`, giản lược cụm phụ âm — trên từ bất kỳ) hiện nổi bật nhưng **không** chặn Đạt; tầng 3
(từ chức năng) chỉ hiện khi mở chi tiết. Dịch vụ chấm lỗi thì nói thẳng là chấm hỏng,
**không đoán bừa một con số**, và buổi luyện vẫn đi tiếp được.

**Định nghĩa Đạt (đã hiệu chỉnh trên giọng người Việt thật)** — Một Lượt **Đạt** khi **mọi
âm vị của mọi Từ mục tiêu đạt ≥ 30 điểm**. Dưới **30** = chặn Đạt; dưới **60** = cảnh báo
tầng 2, không chặn. Mở Thang gợi ý **không** làm mất trạng thái Đạt.

**Thang gợi ý** — Hai nấc theo thứ tự cố định: tình huống (không dịch tiếng Việt), rồi từ
khoá. **Không nấc nào hiện toàn bộ Câu đích.** Mở gợi ý **không gọi mạng** — nội dung đã
sinh sẵn và lưu kèm Kịch bản từ Epic 1. Ghi lại độ sâu ở **ba trạng thái phân biệt được**:
không mở, mở tình huống, mở từ khoá.

**Ba lần thử và hiện đáp án** — Tối đa **3 lần thử mỗi Lượt mỗi buổi** (áp cho từng Lượt,
không phải cả Kịch bản). Đây vừa là ràng buộc sư phạm vừa là **lan can chi phí** — bỏ nó thì
mô hình giá vỡ. Người dùng **không có nút tự bỏ qua**; lối thoát chỉ do hệ thống mở sau đủ
ba lần. Khi mở: hiện Câu đích cỡ lớn, tô rõ âm vị đã hỏng, nút nghe mẫu tốc độ thường, một
khối chỉ dẫn nhắm **đúng âm vị đó** (tên âm + mẹo cấu âm cho người Việt), và nói rõ sẽ gặp
lại câu này ngày mai. Lượt ghi là **chưa Đạt**, không tăng số lần **Nói ra được**, và Từ mục
tiêu bị **đánh dấu để lặp ở buổi sau** — Epic này chỉ *ghi* dấu, phần đọc dấu để xếp lịch
nằm ở Epic 3.

**Đo lường** — **Độ trễ bật câu** đo tại máy từ dạng sóng, từ lúc hiện Lượt đến âm đầu tiên
vượt ngưỡng, **không gọi dịch vụ ngoài**. Chỉ ghi nhận ở Lượt **không mở gợi ý**; Lượt có
gợi ý bị **loại khỏi chuỗi số liệu** và **không ghi giá trị thay thế**.

**Tổng kết** — Số Lượt Đạt trên tổng, Từ mục tiêu nào **Nói ra được lần đầu**, Lượt nào phải
hiện đáp án, và Độ trễ trung bình **so với buổi liền trước**. Khi cả buổi không có Lượt
không-gợi-ý thì nói rõ chưa đủ dữ liệu — **không hiện số 0, không bỏ trống**.

**Bền vững** — Mất mạng giữa buổi vẫn nói và nghe lại được; yêu cầu chấm xếp hàng, có mạng
thì gửi; số liệu các Lượt đã xong **không mất**. `localStorage` không đủ cho audio.

## Technical Decisions

- **Đường ống kỹ thuật đã xong và đã kiểm chứng chạy** — thu PCM qua AudioWorklet, đóng gói
  WAV + đo biên độ đỉnh, route chấm Azure (đo thật ~1,9 giây), và một trang lab chạy được
  nguyên vòng ghi âm → chấm → hiện điểm âm vị. Cái thiếu là **màn hình buổi luyện và logic
  nghiệp vụ**, không phải hạ tầng. Đọc trang lab trước khi viết mới.
- **`MediaRecorder` không dùng được** — nó cho ra webm/opus. Phải đi qua AudioWorklet.
- **Yêu cầu chấm bắt buộc có `Dimension: "Comprehensive"`.** Thiếu nó, dịch vụ **âm thầm**
  hạ xuống chế độ Basic: HTTP 200 bình thường nhưng mất `ErrorType`, `FluencyScore`,
  `CompletenessScore`, `ProsodyScore`. Không lỗi, không cảnh báo.
- **REST cho audio ngắn trả điểm ở cấu trúc phẳng**, khác Speech SDK mà phần lớn ví dụ trên
  mạng dùng. Viết theo hình dạng SDK sẽ ra `undefined` ở mọi trường mà không báo lỗi.
- **Không dùng điểm cấp từ, không dùng cờ lỗi của dịch vụ** — đo được: `walked` đạt 97 điểm
  cấp từ trong khi âm `/t/` cuối là **0**, `ErrorType` trả về `None`. Tệ hơn, chấm bằng điểm
  tổng **thưởng cho người nuốt âm và phạt người cố gắng**: đọc cẩu thả được PronScore cao hơn
  đọc cẩn thận ở 2 trên 3 câu, vì đọc cẩn thận thì chậm và ngắt, làm Fluency/Prosody tụt.
  Cửa quyết định **phải** nằm ở tầng âm vị.
- **`ProsodyScore` phân biệt yếu** (90,3 so với 88,7 giữa đọc tốt và đọc đều đều) — hiện cho
  tham khảo được, **không đủ làm cửa Đạt/Chưa đạt**.
- **Không chấm luyến láy (nối âm)** — không có chỉ số đáng tin, và chấm theo âm vị rời rạc có
  thể trừ điểm người nói đúng.
- **Bậc miễn phí Azure F0 chỉ 1 request đồng thời**, không nâng được — đủ tự thử, không phục
  vụ được người dùng thật. Cùng key, cùng hoá đơn với giọng mẫu của Epic 1.
- **Thư viện chỉ dẫn phát âm là văn bản viết sẵn đóng gói theo app** (~15–20 mục theo âm vị),
  phủ các âm mà tầng 1 và tầng 2 phát hiện. **Không sinh động lúc chạy** — cùng lý do như
  Thang gợi ý.
- **Lưu trữ** — tầng IndexedDB do Epic 1 dựng được **dùng lại** cho bản ghi của người dùng,
  dưới namespace riêng. Đừng nhồi đặc thù TTS vào tầng đó, và đừng đưa audio vào `localStorage`.
- **Gỡ nợ kỹ thuật đi sau, không đi trước** — đường `/practice → VoicePractice.tsx →
  useGeminiLive.ts → /api/live-token` giữ nguyên đang chạy cho đến khi màn hình luyện mới
  hoạt động; xoá sớm thì không còn gì chạy được. Khi gỡ thì gỡ cả ba, `/api/live-token` là
  bắt buộc vì nó trả thẳng `GEMINI_API_KEY` về trình duyệt, và cập nhật `AGENTS.md` bỏ mục
  biện minh cho lỗ đó. **Không bao giờ xoá** worklet ghi âm — nó là hạ tầng dùng chung.
- **Nếu viết lại đường hai chiều sau này thì viết mới, đừng dùng lại code cũ** — nó mang sẵn
  các lỗi đã phát hiện (gửi chunk 8ms thay vì gom, transcript vỡ vụn, VAD phía server chưa
  tắt dù đang push-to-talk).
- Typecheck, lint và build phải sạch.

## UX & Interaction Patterns

- **Bố cục một cột, điện thoại trước:** dải trạng thái trên cùng, luồng chat cuộn ở giữa,
  hàng điều khiển **dính đáy**. Hàng điều khiển giữ nguyên vị trí ở mọi trạng thái — gợi ý
  bên trái, đồng hồ ở giữa, mic bên phải. Nút không được nhảy chỗ khi người dùng đang tập
  trung nói.
- **Nút mic** 52px tròn: bấm để bắt đầu, bấm lần nữa để dừng. **Trạng thái vô hiệu hoá của
  nút mic chính là tín hiệu "chưa tới lượt bạn"** — không có chỉ báo lượt riêng nào khác.
  Quầng sáng xanh khi đang ghi là **ngoại lệ duy nhất** của luật "không dùng đổ bóng".
- **Đồng hồ đếm lên**, `tabular-nums`, không đếm ngược, không giới hạn thời gian, không có gì
  xảy ra ở bất kỳ mốc nào. Nó là thước đo, không phải áp lực.
- **Thẻ điểm dính ngay dưới lượt vừa nói.** Trong ~3 giây chờ chấm: hiện **ngay** câu người
  dùng vừa nói, thẻ điểm hiện dần bên dưới — người dùng có cái để đọc và nhịp trò chuyện
  không gãy.
- **Không trạng thái nào được truyền đạt chỉ bằng màu** — luật bắt buộc. Đạt = `✓` kèm chữ
  "Đạt"; Chưa đạt = `✗` kèm gạch chân sóng dưới âm sai; cảnh báo tầng 2 = `!` kèm viền nét
  đứt. Kết quả phải đọc được bằng trình đọc màn hình, không chỉ nhìn thấy.
- **Giọng huấn luyện viên, xưng "Bạn", nêu cụ thể.** Khi kết quả thật sự tệ thì **chuyển sang
  thẳng và bỏ hẳn phần động viên** — nói *"Gần rồi!"* lúc người dùng sai gần hết là nói dối
  và họ sẽ mất tin vào mọi lời khen sau đó. Cũng không đổ tại micro để gỡ thể diện. Không
  làm to chuyện một lần thất bại bằng hiệu ứng hay chuyển động mạnh.
- **Từ chối quyền micro:** nói rõ vì sao cần và chỉ cách bật lại, **không xin lại lần nữa**.
- Không streak, không huy hiệu, không chuỗi ngày. Bằng chứng tiến bộ duy nhất là con số thời
  gian bật câu tụt xuống và số từ nói ra được tăng lên.
- Token màu, typography (Inter, `family-phonetic` riêng cho ký hiệu IPA), bậc spacing 4px và
  bo góc nằm trong tài liệu DESIGN của UX. Câu tiếng Anh không đổi họ chữ, chỉ to và đậm hơn.

## Cross-Story Dependencies

- **Epic 2 cần Epic 1 xong** — phải có Kịch bản có cấu trúc, Thang gợi ý sinh sẵn, audio mẫu
  đã cache, và tầng IndexedDB.
- **2.1 là nền của cả epic** — khung chat, con trỏ Lượt, và vòng đời buổi luyện là nơi 2.2–2.7
  gắn vào.
- **2.2 → 2.3:** phải có bản thu WAV (đã cắt lặng) trước khi gửi chấm. **2.3 → 2.5:** trạng
  thái Đạt/Chưa đạt và điểm âm vị là thứ quyết định khi nào hiện đáp án và chỉ dẫn nhắm âm nào.
- **2.4 → 2.6:** Độ trễ chỉ ghi ở Lượt không mở gợi ý, nên phải biết độ sâu gợi ý trước.
- **2.7 tiêu thụ số liệu của 2.3, 2.4, 2.5 và 2.6** — làm sau cùng trong nhóm.
- **2.8 phải làm cuối cùng**, chỉ sau khi màn hình luyện mới chạy được.
- **Epic 3 tiêu thụ đầu ra của Epic 2:** dấu "cần lặp lại" từ 2.5 và số lần **Nói ra được** từ
  2.3 là đầu vào của lịch giãn cách. Epic 2 chỉ ghi, không đọc.
