"""Proves the JavaScript gesture rules (vision-hands.js) match the Python rules (gestures.py).

Run from the project root:  python3 scripts/check-parity.py
"""
import json, subprocess, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "opencv-drawing"))
import gestures as g
from test_gestures import make_hand, transform

poses = {"Open palm": dict(index=True, middle=True, ring=True, pinky=True, thumb="out"), "Fist": {}, "One finger": dict(index=True),
         "Two fingers": dict(index=True, middle=True), "Thumbs up": dict(thumb="up"), "Thumbs down": dict(thumb="down"),
         "Pinch": dict(index=True, middle=True, ring=True, pinky=True, pinch=True)}
cases = []
for name, kw in poses.items():
    for angle in (0, 45, 90, 200):
        for scale in (0.5, 1.0, 1.6):
            lm = transform(make_hand(**kw), angle, scale, 0.02, -0.01)
            r = g.classify(lm)
            cases.append({"pose": name, "angle": angle, "scale": scale, "lm": lm, "label": r["label"], "conf": r["confidence"],
                          "pinchRatio": r["pinchRatio"], "norm": g.normalize(lm)})
js = r'''
const fs=require('fs');global.window={};global.document={addEventListener(){},querySelector(){return null},querySelectorAll(){return []}};global.setInterval=()=>0;
eval(fs.readFileSync(process.argv[1]+'/vision-hands.js','utf8'));
const cases=JSON.parse(fs.readFileSync(0,'utf8'));let bad=0;
for(const c of cases){const r=window.HandMath.classify(c.lm),n=window.HandMath.normalize(c.lm);
 const nd=Math.max(...n.map((v,i)=>Math.abs(v-c.norm[i])));
 if(r.label!==c.label||Math.abs(r.confidence-c.conf)>0.011||Math.abs(r.pinchRatio-c.pinchRatio)>0.002||nd>0.001){bad++;console.log('MISMATCH',c.pose,c.angle,c.scale,r.label,c.label,r.confidence,c.conf,nd.toFixed(4));}}
console.log(cases.length+' cases, '+bad+' mismatches');process.exit(bad?1:0);'''
p = subprocess.run(["node", "-e", js, str(root)], input=json.dumps(cases), text=True, capture_output=True)
print(p.stdout.strip(), p.stderr.strip()[:500]); sys.exit(p.returncode)
