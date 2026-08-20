---
title: "Phụ lục — Product Brief: Phòng tập phản xạ tiếng Anh"
status: draft
created: 2026-08-20
updated: 2026-08-20
---

# Phụ lục

Chiều sâu không đưa vào brief nhưng cần cho PRD, thiết kế kỹ thuật, và cho việc
nhớ lại vì sao một số cửa đã bị đóng.

## 1. Mô hình chi phí đầy đủ

### Giá đầu vào (tra ngày 2026-08-20)

| Khoản | Giá | Nguồn |
|---|---|---|
| Chấm phát âm (Azure) | **$1,32 / giờ audio**, tính theo từng giây | Azure Speech pricing |
| TTS giọng mẫu | ~$16 / 1 triệu ký tự | Azure Speech pricing |
| Bậc miễn phí F0 | 5 giờ audio + 0,5 triệu ký tự / tháng | Azure Speech pricing |
| Sinh hội thoại | vài phần nghìn đô mỗi hội thoại | ước, chưa tra |

Chỉ chấm phát âm là đáng kể. TTS và sinh hội thoại đều cache vĩnh viễn nên trở
thành sai số làm tròn. Mô hình vì vậy quy về một biến duy nhất: **số giây audio
người dùng gửi đi chấm**.

### Đơn vị nền

Câu thoại B1 dài 8–14 từ; người học nói chậm hơn bản ngữ; cộng khoảng lặng
đầu/cuối khi ghi âm → **~8 giây một lượt**.

> **1 lượt chấm = 8 giây = $0,0029 ≈ 76đ** *(quy đổi ~26.000đ/USD)*

### Chi phí theo hồ sơ người dùng

Giả định một buổi: hội thoại 10 câu, người dùng nói 5 câu.

| Hồ sơ | Buổi/tháng | Lượt/tháng | Chi phí |
|---|---|---|---|
| Nhẹ — 2-3 lần/tuần | 10 | 150 | ~11.000đ |
| Đều — hằng ngày | 30 | 450 | ~34.000đ |
| Chăm — drill kỹ | 30 | 1.200 | ~90.000đ |

### Trần lý thuyết

Giới hạn là thể chất, không phải ý chí — không ai nói liên tục quá 30-45
phút/ngày.

| Kịch bản | Audio/tháng | Chi phí |
|---|---|---|
| 30 phút nói thật/ngày | 15 giờ | ~515.000đ |
| 60 phút/ngày (phi thực tế) | 30 giờ | ~1.030.000đ |

**Kết luận: không thể bán gói cố định "không giới hạn" ở bất kỳ mức giá nào người
Việt sẵn sàng trả.** Một người dùng cực đoan ngốn hết lợi nhuận của mười lăm người
thường. Hạn mức là bắt buộc, không phải tuỳ chọn.

### Tác động của thiết kế "lặp miễn phí, chấm có chủ ý"

| | Chấm mọi lượt | Chấm có chủ ý |
|---|---|---|
| Lượt chấm/buổi | 15 | 6–8 |
| Chi phí/tháng (dùng đều) | ~34.000đ | ~15.000đ |
| Giá vốn ở gói 99k | ~35% | **~18%** |

### Lãi lỗ trên một người dùng trả phí

| Khoản | Số tiền |
|---|---|
| Doanh thu gộp | 99.000đ |
| − Phí thanh toán (ví nội địa ~3%) | −3.000đ |
| − Thuế hộ kinh doanh (~7% doanh thu) | −6.900đ |
| = Doanh thu thực | 89.100đ |
| − Chấm phát âm (~300 lượt) | −22.800đ |
| − TTS (~10 hội thoại mới) | −2.500đ |
| − Sinh hội thoại | −900đ |
| **= Lãi gộp** | **≈ 62.900đ (64%)** |

Nếu dùng hết 500 lượt: lãi gộp ≈ 47.700đ (48%).

### Chi phí cố định và quy mô

Hosting ~520.000đ + tên miền ~25.000đ = **~545.000đ/tháng**. Azure không có phí cố
định. **Hoà vốn ở 9 người dùng trả phí.**

| Người trả phí | Lãi gộp | Sau chi phí cố định |
|---|---|---|
| 10 | 629.000đ | ~84.000đ |
| 50 | 3,1 triệu | ~2,6 triệu |
| 100 | 6,3 triệu | ~5,7 triệu |
| 500 | 31,5 triệu | ~29 triệu |
| 1.000 | 62,9 triệu | ~59 triệu |

### Vì sao dùng thử là một lần, không phải hằng tháng

Người dùng miễn phí tốn ~2.300đ/tháng. Với chuyển đổi 5%, mỗi người trả tiền gánh
19 người miễn phí = 43.300đ/tháng.

> 62.900đ − 43.300đ = **19.600đ**. Lãi gộp tụt từ 64% xuống 20%; hoà vốn hạ tầng
> nhảy từ 9 lên 28 người trả phí.

Đổi sang **30 lượt tổng cộng, một lần** biến khoản này thành chi phí một lần
~2.300đ mỗi lượt đăng ký. Phần thật sự miễn phí — nghe lại, tự so sánh, đo TTFW —
vẫn mở vô hạn vì nó chạy hoàn toàn tại máy và không tốn gì.

### Van xả cho nhóm cực đoan

Cho người dùng nặng mang API key riêng của họ. Chi phí của ta về 0, họ được không
giới hạn. Nhóm này nhỏ nhưng ồn ào — cho họ một lối đi hợp lệ tốt hơn là để họ phá
mô hình.

## 2. Chấm điểm: cái gì đo được, cái gì không

| Mong muốn | Đo được bằng | Mức |
|---|---|---|
| Lỗi phát âm từng âm | `AccuracyScore` cấp phoneme + `Mispronunciation`/`Omission`/`Insertion` | ✅ tốt |
| Nói thiếu, bỏ từ | `CompletenessScore` | ✅ tốt |
| Trôi chảy, ngắt nghỉ | `FluencyScore` + `UnexpectedBreak`/`MissingBreak` | ✅ tốt |
| Ngữ điệu | `ProsodyScore` + cờ `Monotone` | 🟡 thô |
| **Luyến láy (nối âm)** | **không có chỉ số riêng** | ❌ |

Cảnh báo về luyến láy: chấm theo phoneme rời rạc có thể **trừ điểm người nói đúng**
kiểu nối âm tự nhiên, vì nó lệch khỏi cách phát âm từng-từ-một trong từ điển. Không
hứa hẹn tính năng này ở v1. Nếu làm sau, phải đánh dấu sẵn cặp nối âm trong kịch
bản rồi kiểm `MissingBreak` tại đúng vị trí, chứ không có API nào trả về "bạn chưa
nối âm".

## 3. Phân tầng từ khoá

Yêu cầu gốc: "từ nào là key để người nghe hiểu thì phải chính xác". Diễn giải
thành ba tầng, **không tầng nào chặn cứng người dùng**.

| Tầng | Gồm | Xử lý |
|---|---|---|
| **T1 — Bắt buộc** | Từ vựng mục tiêu lấy từ danh sách người dùng | Sai/thiếu → chưa đạt, mời thử lại |
| **T2 — Quan trọng** | Đuôi `-s`/`-ed`, phụ âm cuối, cụm phụ âm | Cảnh báo nổi bật, trừ điểm nặng, không chặn |
| **T3 — Tham khảo** | Mạo từ, giới từ, từ chức năng | Chỉ hiện trong chi tiết |

T2 tạo ra nhiều giá trị hơn T1: T1 là lỗi người dùng biết mình đang học, T2 là lỗi
họ mắc mà **không biết mình mắc**.

Định nghĩa "Đạt" để sau còn kiểm chứng được:

> Một lượt đạt khi (1) mọi từ T1 có `ErrorType ≠ Omission` và `AccuracyScore ≥ 60`,
> và (2) `CompletenessScore ≥ 70`. Lỗi T2 hiển thị nổi bật nhưng không ảnh hưởng
> trạng thái Đạt ở v1.

**Hai ngưỡng 60/70 là giả định chưa hiệu chỉnh** — phải chỉnh bằng dữ liệu giọng
người Việt thật, không phải chọn cho có.

## 4. Lỗi đặc trưng của người Việt và bộ câu thử

Người Việt nuốt phụ âm cuối một cách hệ thống vì tiếng Việt không có cụm phụ âm
cuối. Đây không phải lỗi thẩm mỹ — mất `-ed` là mất thì, mất `-s` là mất số nhiều,
người nghe hiểu sai.

Bộ câu thử đã cài trong `/lab/pronunciation`, mỗi câu cô lập một kiểu lỗi:

| Kiểu lỗi | Câu thử |
|---|---|
| Phụ âm cuối + `-ed` | *I walked to the shop and asked for a cold drink.* |
| Đuôi `-s` | *She books three tickets and packs six bags.* |
| `/θ/` và `/ð/` | *I think this thing is worth three thousand.* |
| Nguyên âm dài/ngắn, `/s/` vs `/ʃ/` | *The cheap ship left the sheep on the beach.* |
| Cụm phụ âm | *The strong students struggled with the strange text.* |
| Ngữ điệu câu hỏi | *Are you sure you want to leave already?* |

## 5. Ràng buộc kỹ thuật cho PRD

- **Clip tối đa 30 giây.** Không thể chấm cả đoạn hội thoại trong một lần gọi —
  bắt buộc thiết kế chấm từng câu. Trùng với cơ chế drill nên không phải hạn chế.
- **Định dạng bắt buộc:** PCM 16 kHz, 16-bit, mono, trong container WAV.
  `MediaRecorder` cho ra webm/opus nên không dùng được; phải thu qua AudioWorklet.
  Đã có sẵn: `lib/wav.ts` và `public/audio-processor.worklet.js`.
- **Endpoint:** REST cho audio ngắn, cấu hình qua header `Pronunciation-Assessment`
  chứa JSON mã hoá base64. Không dùng được endpoint fast transcription.
- **Cắt khoảng lặng đầu/cuối trước khi gửi** — tính tiền theo giây, cắt 2s khỏi
  clip 8s là giảm 25% chi phí với công sức không đáng kể.
- **TTFW đo tại máy** từ dạng sóng: khoảng cách từ lúc hiện gợi ý đến mẫu âm đầu
  tiên vượt ngưỡng. Không tốn API.
- **Bản thu lưu ở IndexedDB, không phải localStorage** — localStorage giới hạn ~5MB
  và audio sẽ làm vỡ ngay.
- **Kịch bản phải là dữ liệu có cấu trúc.** Hiện `dialogue` là chuỗi markdown với
  tiền tố `**A (Alex):**`, không parse tin cậy được. Phải đổi sang JSON có schema.
  Đây là thay đổi nền tảng, mọi thứ khác phụ thuộc vào nó.
- **Tách lớp `VocabularySource` sớm.** `ParsedCard` hiện chỉ có 4 trường và 8 file
  import nó thuần dưới dạng kiểu — ràng buộc còn nông. Tách bây giờ tốn ~30 phút;
  sau sáu tháng thì đắt hơn nhiều.

## 6. Kết quả kiểm chứng đã chạy

Ngày 2026-08-20, qua `/lab/pronunciation`, dùng giọng tổng hợp macOS:

- **Mẫu A** đọc đúng câu tham chiếu.
- **Mẫu B** mô phỏng lỗi người Việt: *"I walk to the sop and ass for a coal drin."*

Gemini ghi lại mẫu B thành *"I walked to the sop and asked for a cold drink"* —
**tự sửa 4 trên 5 lỗi**, dù prompt yêu cầu rõ ràng không được sửa. Trên mẫu A đọc
hoàn toàn chuẩn, nó **bịa ra lỗi**, báo âm `/t/` cuối của `walked` và `asked` "gần
như bị lược bỏ". Độ trễ 5,8–8,7 giây. Kết quả lặp lại chính xác ở nhiệt độ 0 — ổn
định ở một con số sai.

**Kết luận: Gemini không làm engine chấm điểm được.** Nó không có mô hình âm học;
nó suy ra điều người nói *có lẽ muốn nói*, đúng ngược với việc chấm phát âm cần.

Vai trò còn lại của Gemini: sinh kịch bản, viết nhận xét tiếng Việt (phần này thật
sự tốt), và kiểm tra diễn đạt tương đương ở Cấp 3.

**Chưa kiểm chứng:** Azure, vì chưa có API key. Và cả hai mới chỉ thử trên giọng
tổng hợp — giọng máy sạch một cách phi thực tế, chưa thay được phép thử trên giọng
người Việt thật.

## 7. Bản đồ cạnh tranh

| Đối thủ | Giải quyết | Không giải quyết |
|---|---|---|
| ELSA Speak | Phát âm chuẩn từng âm | Tốc độ bật câu; giáo trình cố định |
| Duolingo | Duy trì thói quen, nhận diện từ | Sản sinh lời nói |
| Cake | Nghe ngữ liệu thật, nhại theo | Câu của người khác, không phải nhu cầu của bạn |
| Anki / Mochi | Ghi nhớ dài hạn | Chưa từng bắt mở miệng |
| Gia sư người thật | Gần như tất cả | Đắt, phải hẹn giờ, không lặp 30 lần được |
| ChatGPT voice | Hội thoại vô hạn, gần như miễn phí | Không áp lực thời gian, không lặp, không đo |

Cột phải là khoảng trống tất cả cùng để lại.

## 8. Những cửa đã đóng và lý do

**Cấp 4 — hội thoại tự do.** Bỏ reference text là quay lại bài toán unscripted
assessment, độ chính xác rơi, và ta trở về đúng chỗ đang đứng hôm nay. Đây là canh
bạc riêng, không phải cấp tiếp theo của thang.

**AnkiConnect làm nguồn chính.** Add-on chạy trong Anki Desktop, nghe ở
`127.0.0.1:8765` — trên điện thoại không có gì để kết nối tới. Mâu thuẫn trực tiếp
với định vị "luyện hằng ngày", vì luyện hằng ngày xảy ra trên điện thoại. Thay bằng
xuất file `.txt`/`.apkg` từ Anki rồi tải lên: vẫn là từ của người dùng, chạy được
trên di động, không cần cài add-on. Đánh đổi: mất đồng bộ tự động và mất vòng lặp
ghi ngược về Anki.

**Gói miễn phí hằng tháng.** Xem mục 1 — nó cắt lãi gộp từ 64% xuống 20%.

**App native.** Cửa hàng ứng dụng cắt 15–30%, tương đương gần hết lãi gộp. Web
(PWA) là quyết định kinh tế trước khi là quyết định kỹ thuật.

**Đua điểm phát âm với ELSA.** Chấm phát âm là tính năng hỗ trợ, không phải sản
phẩm. Đẩy nó lên đầu trong truyền thông là tự đặt mình vào trận đánh thua chắc.

**Thuật toán lặp lại ngắt quãng riêng.** Anki là 15 năm công sức và một cộng đồng
trung thành. "Kho từ vựng riêng" nghĩa là nơi chứa từ + nghĩa, không phải đối thủ
của Anki. Ai đề xuất làm SRS riêng là đã trượt khỏi phạm vi.


## 9. Cơ sở của nhận định cốt lõi

### Ủng hộ

**Bốn nhánh (Nation, 2007).** Một khoá học cân bằng gồm bốn nhánh, mỗi nhánh ~25%
thời gian: đầu vào hướng nghĩa, đầu ra hướng nghĩa, học có chủ đích, và **phát
triển trôi chảy**. Nhánh thứ tư được định nghĩa là hoạt động mà người học *không
gặp gì mới*, chỉ nhằm dùng thành thạo hơn thứ đã biết. Nation cho rằng nó phải
chiếm không dưới 25%; người tự học dành cho nó gần 0%.

**Cơ chế.** Lần nói đầu tiên người học phải kích hoạt vốn từ L2; những lần sau
truy xuất nhanh hơn vì từ đã sẵn. Cái được rút ngắn chính là **độ trễ truy xuất** —
đúng biến mà TTFW đo.

**Kỹ thuật 4/3/2 (Nation, 1989).** Kể cùng câu chuyện ba lần trong 4, 3, rồi 2
phút. Đo được: 86 → 100 → 127 từ/phút (+48%), ngập ngừng và khởi đầu hụt giảm rõ.
Hiệu ứng ổn định bất kể trình độ hay loại nhiệm vụ.

### Chống lại

**Chuyển giao chưa được chứng minh.** Chưa nghiên cứu nào chỉ rõ rằng lợi ích của
lặp nhiệm vụ chuyển sang nhiệm vụ mới; nhiều thành quả không mang sang được bối
cảnh khác. Đây là lỗ hổng nghiêm trọng nhất.

**Tiền lệ Nghe–Nói (Audiolingual, 1950–60).** Xây toàn bộ trên drill mẫu câu. Học
viên thành thạo cấu trúc nhưng không giao tiếp được ngoài lớp. Khác biệt cứu ta —
nếu có — là drill Nghe–Nói vô nghĩa, còn phát triển trôi chảy có nghĩa và hướng
vào truyền đạt. Khác biệt có thật nhưng chưa đủ để coi là đã giải quyết.

**Chỉ trôi chảy, không chính xác.** Lặp lại tăng tốc độ; độ chính xác ngữ pháp và
độ phức tạp câu gần như không đổi.

### Quy tắc thiết kế rút ra: giãn, đừng dồn

Suzuki (2022) cho người học lặp cùng bài nói sáu lần theo ba lịch. Nhóm **dồn hết
vào một buổi**:

| | Kết quả |
|---|---|
| Ngắt quãng, ngập ngừng | ✅ giảm nhiều nhất |
| Tốc độ phát âm | ❌ **chậm đi** |
| Lặp từ như vẹt | ❌ **tăng** |
| Một tuần sau | ❌ vẫn lặp như vẹt nhiều hơn |

**Quy tắc cho v1:** tối đa 2–3 lượt một câu trong một buổi; đưa câu quay lại ở
buổi sau. Điều này mâu thuẫn với giả định "lặp đến khi bật ra trong 2 giây" của
bản thảo đầu và đã được sửa trong brief.

Lịch giãn cách này **không** đảo ngược quyết định không xây SRS riêng: lên lịch
cho một **câu drill** quay lại khác với cạnh tranh với Anki ở việc ghi nhớ thẻ.

### Hệ quả cho định vị

Nation đòi **cả bốn nhánh**. Ta không cần tự cung cấp phần hội thoại — thị trường
đã cho không (ChatGPT voice). Lời hứa trung thực: *"chúng tôi làm phần không ai
làm; phần còn lại bạn lấy miễn phí ở chỗ khác."* Đây là lý do thật để gác Cấp 4,
thay cho lý do kỹ thuật đã nêu ở mục 8.
