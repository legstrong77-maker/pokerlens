# Evaluate card-level detection on real photos (mirrors app/js/app/detector.js pipeline).
import glob, os, time, sys
import numpy as np, onnxruntime as ort
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from yaml_free_names import NAMES as GT_NAMES
RF = ["10C","10D","10H","10S","2C","2D","2H","2S","3C","3D","3H","3S","4C","4D","4H","4S","5C","5D","5H","5S","6C","6D","6H","6S","7C","7D","7H","7S","8C","8D","8H","8S","9C","9D","9H","9S","AC","AD","AH","AS","JC","JD","JH","JS","KC","KD","KH","KS","QC","QD","QH","QS"]

def letterbox(img, S=640):
    w0, h0 = img.size; k = min(S / w0, S / h0)
    w, h = round(w0 * k), round(h0 * k)
    dx, dy = (S - w) // 2, (S - h) // 2
    canvas = Image.new('RGB', (S, S), (114, 114, 114))
    canvas.paste(img.resize((w, h), Image.BILINEAR), (dx, dy))
    a = np.asarray(canvas, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
    return a, k, dx, dy, w0, h0

def detect(sess, img, conf, S=640):
    a, k, dx, dy, w0, h0 = letterbox(img, S)
    out = sess.run(None, {sess.get_inputs()[0].name: a})[0][0]  # [56, N]
    scores = out[4:]; cls = scores.argmax(0); best = scores.max(0)
    keep = np.where(best >= conf)[0]
    dets = []
    for i in keep:
        cx, cy, w, h = out[0, i], out[1, i], out[2, i], out[3, i]
        x = (cx - w / 2 - dx) / k / w0; y = (cy - h / 2 - dy) / k / h0
        dets.append((float(best[i]), int(cls[i]), (x, y, w / k / w0, h / k / h0)))
    dets.sort(key=lambda d: -d[0])
    kept = []
    def iou(a, b):
        x1, y1 = max(a[0], b[0]), max(a[1], b[1]); x2, y2 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
        inter = max(0, x2 - x1) * max(0, y2 - y1); return inter / (a[2] * a[3] + b[2] * b[3] - inter + 1e-9)
    for d in dets:
        if any(iou(d[2], k2[2]) > 0.5 for k2 in kept): continue
        kept.append(d)
    return {RF[d[1]] for d in kept}

def gt_cards(label_file):
    s = set()
    for line in open(label_file):
        p = line.split()
        if not p: continue
        i = int(p[0])
        # dataset quirk: ids 0-18 are shifted one slot vs data.yaml; id 20 ('59') is really 10D
        n = '10D' if i == 20 else GT_NAMES[i + 1] if i < 19 else GT_NAMES[i]
        if n: s.add(n)
    return s

imgs = sorted(glob.glob(os.path.join(os.path.dirname(__file__), 'photos', 'images', '*.jpg')))
for model in ['cards-fast', 'cards-accurate']:
    sess = ort.InferenceSession(os.path.join(os.path.dirname(__file__), '..', 'app', 'models', model + '.onnx'), providers=['CPUExecutionProvider'])
    for conf in [0.25, 0.35, 0.45, 0.55]:
        tp = fp = fn = exact = 0; t = 0
        for f in imgs:
            gt = gt_cards(f.replace('images', 'labels').rsplit('.', 1)[0] + '.txt')
            img = Image.open(f).convert('RGB')
            t0 = time.time(); pred = detect(sess, img, conf); t += time.time() - t0
            tp += len(pred & gt); fp += len(pred - gt); fn += len(gt - pred); exact += pred == gt
        print(f'{model:15s} conf={conf:.2f}  recall={tp/(tp+fn):.3f}  precision={tp/(tp+fp+1e-9):.3f}  exact-image={exact}/{len(imgs)}  avg {1000*t/len(imgs):.0f} ms (CPU)')
