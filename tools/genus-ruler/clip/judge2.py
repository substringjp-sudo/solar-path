# CLIP 판정기 — 사진·렌더를 같은 전처리로 넣고 구름 종류 문장과의 유사도를 봅니다.
import json, os, sys, numpy as np, onnxruntime as ort
from PIL import Image
from tokenizers import Tokenizer
H = os.path.dirname(os.path.abspath(__file__))
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], np.float32); STD = np.array([0.26862954, 0.26130258, 0.27577711], np.float32)
_v = _t = _tok = None
def vis():
    global _v
    if _v is None: _v = ort.InferenceSession(os.path.join(H, 'vision_model_quantized.onnx'))
    return _v
def prep(img, top=1.0):
    img = img.convert('RGB')
    if top < 1.0: img = img.crop((0, 0, img.width, max(8, int(img.height * top))))
    s = 224 / min(img.size); img = img.resize((max(224, round(img.width * s)), max(224, round(img.height * s))), Image.BICUBIC)
    l = (img.width - 224) // 2; t = (img.height - 224) // 2; img = img.crop((l, t, l + 224, t + 224))
    a = (np.asarray(img, np.float32) / 255 - MEAN) / STD
    return a.transpose(2, 0, 1)
def embed_images(imgs, tops):
    out = []
    for i in range(0, len(imgs), 8):
        x = np.stack([prep(im, tp) for im, tp in zip(imgs[i:i + 8], tops[i:i + 8])])
        e = vis().run(None, {'pixel_values': x})[0]; out.append(e / np.linalg.norm(e, axis=1, keepdims=True))
    return np.concatenate(out)
def embed_text(texts):
    global _t, _tok
    if _t is None:
        _t = ort.InferenceSession(os.path.join(H, 'text_model_quantized.onnx')); _tok = Tokenizer.from_file(os.path.join(H, 'tokenizer.json'))
    ids = [_tok.encode(s).ids[:77] for s in texts]; L = max(len(i) for i in ids)
    # 패딩은 끝 토큰(eos)으로 — CLIP 은 eos 위치(최대 id)의 출력을 씁니다.
    eos = ids[0][-1]; x = np.array([i + [eos] * (L - len(i)) for i in ids], np.int64)
    e = _t.run(None, {'input_ids': x})[0]; return e / np.linalg.norm(e, axis=1, keepdims=True)
PROMPTS = json.load(open(os.path.join(H, 'prompts2.json')))
def class_embeds(group):
    names = list(PROMPTS[group].keys()); C = []
    for n in names:
        e = embed_text(PROMPTS[group][n]).mean(0); C.append(e / np.linalg.norm(e))
    return names, np.stack(C)
def probs(E, C, T=100.0):
    z = T * E @ C.T; z -= z.max(1, keepdims=True); p = np.exp(z); return p / p.sum(1, keepdims=True)
