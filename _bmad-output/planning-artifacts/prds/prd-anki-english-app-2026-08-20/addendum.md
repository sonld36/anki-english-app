---
title: "Phụ lục PRD — Phòng tập phản xạ tiếng Anh"
status: draft
created: 2026-08-20
updated: 2026-08-20
---

# Phụ lục PRD

Chi tiết kỹ thuật và số liệu đo được, dành cho người thiết kế kiến trúc và người
viết code. Không thuộc về PRD nhưng cần thiết để hiện thực đúng.

## 1. Tích hợp dịch vụ chấm phát âm — những chỗ đã sập bẫy

Đã kiểm chứng trực tiếp ngày 2026-08-20, vùng `southeastasia`, độ trễ ~1,9 giây.

### Bẫy 1 — `Dimension: "Comprehensive"` là bắt buộc

Không có tham số này, dịch vụ **âm thầm hạ xuống chế độ `Basic`**: chỉ trả
`AccuracyScore`, **không** có `ErrorType`, `FluencyScore`, `CompletenessScore`, hay
`ProsodyScore`. Không báo lỗi, không cảnh báo, HTTP 200 bình thường.

Đã thử bốn biến thể để khoanh vùng:

| Cấu hình | Điểm trả về | Có `ErrorType`? |
|---|---|---|
| Đầy đủ, thiếu `Dimension` | chỉ `AccuracyScore` | Không |
| Bỏ `EnableProsodyAssessment` | chỉ `AccuracyScore` | Không |
| Tối giản | chỉ `AccuracyScore` | Không |
| **Thêm `Dimension: "Comprehensive"`** | **đủ 5 điểm** | **Có** |

### Bẫy 2 — REST trả cấu trúc phẳng, khác Speech SDK

Tài liệu và ví dụ trên mạng phần lớn dùng Speech SDK, nơi điểm nằm lồng trong
`PronunciationAssessment`. **REST API cho audio ngắn trả điểm phẳng:**

```
NBest[0].PronScore | .AccuracyScore | .FluencyScore
        .CompletenessScore | .ProsodyScore
NBest[0].Words[i].AccuracyScore | .ErrorType
NBest[0].Words[i].Phonemes[j].Phoneme | .AccuracyScore | .NBestPhonemes[]
                 .Syllables[j].Syllable | .Grapheme | .AccuracyScore
```

Viết theo hình dạng của SDK sẽ ra `undefined` ở mọi trường mà không báo lỗi.

### Cấu hình đã kiểm chứng chạy đúng

```json
{
  "ReferenceText": "...",
  "GradingSystem": "HundredMark",
  "Granularity": "Phoneme",
  "Dimension": "Comprehensive",
  "EnableMiscue": true,
  "EnableProsodyAssessment": true,
  "PhonemeAlphabet": "IPA",
  "NBestPhonemeCount": 5
}
```
Mã hoá base64, đặt vào header `Pronunciation-Assessment`.

### Ràng buộc khác

- Clip **tối đa 30 giây** — bắt buộc chấm theo từng **Lượt**.
- Audio phải là **PCM 16 kHz, 16-bit, mono** trong container WAV. `MediaRecorder`
  cho ra webm/opus, không dùng được — phải thu qua AudioWorklet.
- Bậc miễn phí F0: 5 giờ audio/tháng, **chỉ 1 request đồng thời**, không nâng được.
  Đủ để tự thử, không phục vụ được người dùng thật.
- Tính tiền theo **từng giây** → cắt khoảng lặng đầu/cuối là giảm chi phí trực tiếp.

## 2. Số liệu hiệu chỉnh

Nguồn: giọng tổng hợp macOS `say`, hai bản đọc cùng một câu tham chiếu.
**Chưa phải giọng người Việt thật** — mọi con số dưới đây là tạm.

### Điểm tổng thể

| | Đọc đúng | Có lỗi |
|---|---|---|
| PronScore | 96,1 | 84,3 |
| Accuracy | 100 | 84 |
| Fluency | 100 | 86 |
| Completeness | 100 | 82 |
| Prosody | 90,3 | 87,7 |

Không có lỗi giả nào trên bản đọc đúng — mọi từ 100 điểm, `ErrorType` đều là `None`.

### Vì sao ngưỡng cấp từ không dùng được

Phép thử riêng cho lỗi nuốt phụ âm cuối, đặt ở ngữ cảnh **bắt buộc phải bật âm**
(trước nguyên âm hoặc trước dấu ngắt):

| Đọc sai | Điểm từ | `ErrorType` | Âm vị cuối |
|---|---|---|---|
| `walk` thay `walked` | 97 | None | **t = 46** |
| `ask` thay `asked` | 97 | None | t = 86 |
| `arrive` thay `arrived` | 91 | None | **d = 0**, v = 23 |

PronScore cả câu: **96,1 so với 95,1** — chênh một điểm giữa bản đọc đúng và bản
nuốt sạch đuôi từ.

**Kết luận: cửa quyết định phải nằm ở tầng âm vị.** Ngưỡng tạm 50.

### Lỗi thiết kế phép thử, ghi lại để không lặp lại

Bộ câu thử đầu tiên đặt `-ed` trước phụ âm — *"walked **to**"*, *"cold **drink**"*.
Đó là chỗ người bản ngữ **vốn không bật âm cuối**, nên Azure cho 100 điểm có thể là
**đúng**, không phải bỏ sót. Phải thay bằng ngữ cảnh trước nguyên âm hoặc trước dấu
ngắt mới đo được. Ràng buộc này đã đưa vào FR-6.

### Chấm ngữ điệu

`ProsodyScore` chạy nhưng phân biệt yếu: 90,3 so với 88,7 giữa bản đọc tốt và bản
đọc đều đều. Đủ để hiện cho người dùng tham khảo, **không đủ để làm cửa Đạt/Chưa đạt**.

## 3. Còn phải làm

- **Hiệu chỉnh trên giọng người Việt thật** — dự kiến tối 2026-08-20. Cần ít nhất:
  một người đọc chuẩn hết sức, cùng người đó cố tình nuốt đuôi từ, và một bản đọc
  bình thường không cố gắng gì.
- **Thử tắt/bật khử ồn của trình duyệt** — nghi ngờ nó ăn mất âm xát `/s/`, `/θ/`,
  đúng những âm cần đo. Lab đã có công tắc.
- **Chốt ngưỡng âm vị** sau khi có hai bộ số liệu trên.


## 4. Phân công dịch vụ

Gemini **không** bị thay bằng Azure. Chỉ cơ chế giọng nói hai chiều của Gemini bị bỏ.

| Việc | Dịch vụ | Ghi chú |
|---|---|---|
| Sinh **Kịch bản** | Gemini | Đã chạy, giữ nguyên |
| Sinh nội dung **Thang gợi ý** | Gemini | Cùng lần gọi với **Kịch bản**, cache |
| Nhận xét tiếng Việt cho người học | Gemini | Đã kiểm chứng: phần này nó làm tốt |
| Kiểm tra diễn đạt tương đương (về sau) | Gemini | Một lần gọi văn bản, rẻ |
| **Chấm phát âm** | Azure | Năng lực mới, trước đây không có |
| **Giọng mẫu bản ngữ** | Azure | Cùng key, F0 cho sẵn 0,5 triệu ký tự/tháng |

**Vì sao Azure làm luôn giọng mẫu:** một key, một hoá đơn, không kéo thêm nhà cung
cấp thứ ba. `SpeechSynthesis` của trình duyệt miễn phí nhưng giọng máy móc — không
dùng được cho app dạy phát âm.

**Vì sao Gemini không chấm được:** nó không có mô hình âm học; nó suy ra điều người
nói *có lẽ muốn nói*. Đo ngày 2026-08-20: nó tự chữa 4 trên 5 lỗi cài sẵn và bịa lỗi
trên bản đọc chuẩn.

## 5. Nợ kỹ thuật phải gỡ

Đường Gemini Live không còn là hướng phát triển. **Giữ nguyên đang chạy** cho đến khi
màn hình luyện mới hoạt động — xoá sớm thì không còn gì chạy được.

Chuỗi phụ thuộc hiện tại:

```
/practice → components/VoicePractice.tsx → hooks/useGeminiLive.ts → /api/live-token
```

Gỡ cả ba khi có bản thay thế. Riêng `/api/live-token` **bắt buộc** phải gỡ: nó trả
thẳng `GEMINI_API_KEY` về trình duyệt. Chừng nào đường Live còn sống thì lỗ đó còn
được biện minh trong `AGENTS.md`.

**Không xoá `public/audio-processor.worklet.js`** — nó là hạ tầng ghi âm dùng chung,
lab chấm phát âm và màn hình luyện mới đều cần.

Nếu Cấp 4 quay lại sau này thì viết mới, đừng dùng lại: code cũ mang sẵn các lỗi đã
phát hiện — gửi chunk 8ms thay vì gom, transcript vỡ vụn thành nhiều tin nhắn, VAD
phía server chưa tắt dù đang dùng push-to-talk.
