#!/usr/bin/env python3
"""Assemble l'export Web de Godot en UN SEUL fichier HTML auto-suffisant.

Pourquoi : une page publiee sur claude.ai ne peut joindre aucun hote externe
et ne peut pas telecharger de fichier annexe. Or l'export Godot est eclate en
index.html + index.js + index.wasm + index.pck. Ce script les recoud.

Comment :
  - le .wasm (~39 Mo) est gzippe puis encode en base64 (~13 Mo) ;
  - la page le decompresse dans le navigateur via DecompressionStream ;
  - `fetch` est detourne pour servir les fichiers depuis la memoire, sans
    qu'aucune requete reseau ne parte.

Usage :
    python3 tools/build_single_file_web.py build/web build/sorio.html
"""

import base64
import gzip
import json
import sys
from pathlib import Path

TEMPLATE = """<title>SORIO</title>
<style>
  /* Ecran mono-theme assume : c'est une nuit dans la Vallee des Fougeres,
     pas un document. Toutes les couleurs sont peintes explicitement pour
     que la page tienne quel que soit le fond de l'hote. */
  :root {
    --night:  #0d1a24;   /* ciel de la vallee, couleur de fond du jeu */
    --deep:   #09131b;
    --fern:   #2f6b3a;   /* vert de la tunique de SORIO */
    --fern-2: #1e4a2a;
    --amber:  #ffb43d;   /* la monnaie du jeu */
    --scarf:  #e5342b;   /* l'echarpe rouge, repere visuel de SORIO */
    --bone:   #eae3d2;   /* neutre tire vers le chaud, pas un gris pur */
    --moss:   #7d8f74;   /* neutre tire vers l'accent vert */
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%%; }
  body {
    background: var(--night); color: var(--bone); overflow: hidden;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  #shell { position: fixed; inset: 0; }
  #canvas { display: block; width: 100%%; height: 100%%; border: 0; outline: none; }
  #canvas:focus-visible { outline: 3px solid var(--amber); outline-offset: -3px; }

  #boot {
    position: fixed; inset: 0; z-index: 10; overflow: hidden;
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 32px;
    background: linear-gradient(180deg, var(--deep) 0%%, var(--night) 55%%);
  }
  /* Bandes de parallaxe : echo des 4 plans de B.10 (ciel, collines,
     vegetation, sol jouable), dessinees en CSS et non en images. */
  .plane { position: absolute; left: -10%%; width: 120%%; pointer-events: none; }
  .hills {
    bottom: 26%%; height: 30%%; background: var(--fern-2); opacity: .40;
    clip-path: polygon(0 100%%, 0 52%%, 9%% 30%%, 18%% 55%%, 30%% 22%%, 42%% 58%%,
      55%% 34%%, 68%% 62%%, 80%% 30%%, 92%% 56%%, 100%% 38%%, 100%% 100%%);
    animation: drift 34s ease-in-out infinite alternate;
  }
  .ferns {
    bottom: 0; height: 34%%; background: var(--fern); opacity: .30;
    clip-path: polygon(0 100%%, 0 60%%, 6%% 26%%, 12%% 62%%, 20%% 18%%, 27%% 64%%,
      36%% 30%%, 45%% 66%%, 54%% 22%%, 63%% 62%%, 72%% 34%%, 82%% 64%%, 90%% 26%%,
      100%% 58%%, 100%% 100%%);
    animation: drift 22s ease-in-out infinite alternate-reverse;
  }
  .ground { bottom: 0; height: 12%%; background: var(--fern-2); opacity: .55; }
  @keyframes drift { from { transform: translateX(-2%%); } to { transform: translateX(2%%); } }
  @media (prefers-reduced-motion: reduce) { .plane { animation: none; } }

  .stack {
    position: relative; z-index: 1; display: flex; flex-direction: column;
    align-items: center; gap: 22px; text-align: center; max-width: 46rem;
  }
  h1 {
    margin: 0; font-size: clamp(56px, 13vw, 128px); font-weight: 900;
    letter-spacing: -.03em; line-height: .9;
    background: linear-gradient(150deg, var(--amber) 25%%, var(--scarf) 95%%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .tagline {
    margin: 0; font-size: clamp(13px, 2.2vw, 17px); color: var(--moss);
    text-transform: uppercase; letter-spacing: .22em;
  }
  #status { margin: 0; color: var(--bone); font-size: 17px; min-height: 1.4em; }

  /* La barre de chargement est une veine d'ambre : la monnaie du jeu. */
  #bar {
    width: min(440px, 82vw); height: 12px; border-radius: 999px;
    background: #16242f; overflow: hidden; box-shadow: inset 0 1px 3px #0006;
  }
  #fill {
    height: 100%%; width: 0%%; border-radius: 999px;
    background: linear-gradient(90deg, var(--fern) 0%%, var(--amber) 100%%);
    transition: width .25s ease;
  }

  #play {
    margin-top: 4px; padding: 18px 52px; font: inherit; font-size: 22px;
    font-weight: 800; letter-spacing: .04em; cursor: pointer;
    color: var(--deep); background: var(--amber);
    border: 0; border-bottom: 4px solid #c98a24; border-radius: 14px;
    transition: transform .08s ease, filter .08s ease;
  }
  #play:hover { filter: brightness(1.06); }
  #play:active { transform: translateY(3px); border-bottom-width: 1px; }
  #play:focus-visible { outline: 3px solid var(--bone); outline-offset: 3px; }
  #play[hidden] { display: none; }

  /* Les commandes sont montrees, pas racontees en paragraphe. */
  .controls {
    display: flex; flex-wrap: wrap; justify-content: center; gap: 12px 26px;
    margin: 0; padding: 0; list-style: none; color: var(--moss); font-size: 14px;
  }
  .controls li { display: flex; align-items: center; gap: 8px; }
  kbd {
    display: inline-block; padding: 3px 9px; border-radius: 6px;
    background: #1a2a36; border: 1px solid #2b3f4e; border-bottom-width: 2px;
    color: var(--bone); font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 12px;
  }
  .err { color: #ff9a8f; padding: 16px; font-family: ui-monospace, monospace; }
</style>

<div id="shell"><canvas id="canvas" tabindex="0"></canvas></div>

<div id="boot">
  <div class="plane hills"></div>
  <div class="plane ferns"></div>
  <div class="plane ground"></div>

  <div class="stack">
    <h1>SORIO</h1>
    <p class="tagline">La legende des 7 cristaux</p>
    <p id="status">La vallee se reveille&hellip;</p>
    <div id="bar"><div id="fill"></div></div>
    <button id="play" hidden>Commencer l&rsquo;aventure</button>
    <ul class="controls">
      <li><kbd>&larr;</kbd><kbd>&rarr;</kbd> courir</li>
      <li><kbd>Espace</kbd> sauter</li>
      <li><kbd>F1</kbd> reglages de physique</li>
      <li>Au doigt : stick a gauche, <kbd>A</kbd> a droite</li>
    </ul>
  </div>
</div>

<script>
// --- Donnees embarquees ----------------------------------------------------
const WASM_GZ_B64 = "%(wasm)s";
const PCK_B64 = "%(pck)s";
const GODOT_CONFIG = %(config)s;
const WORKLETS = %(worklets)s;

// Les worklets audio se chargent par URL, pas par fetch : `addModule` va
// chercher un vrai fichier. On lui donne un blob construit en memoire,
// sinon le son est muet et la console crache une erreur a chaque demarrage.
if (typeof AudioWorklet !== "undefined") {
  const originalAddModule = AudioWorklet.prototype.addModule;
  AudioWorklet.prototype.addModule = function (url) {
    for (const name in WORKLETS) {
      if (String(url).endsWith(name)) {
        const blob = new Blob([WORKLETS[name]], { type: "application/javascript" });
        return originalAddModule.call(this, URL.createObjectURL(blob));
      }
    }
    return originalAddModule.call(this, url);
  };
}

const statusEl = document.getElementById("status");
const fillEl = document.getElementById("fill");
const playEl = document.getElementById("play");
const bootEl = document.getElementById("boot");

function setStatus(text, percent) {
  statusEl.textContent = text;
  if (percent !== undefined) fillEl.style.width = percent + "%%";
}

// Decodage base64 par tranches : un atob() sur 13 Mo d'un coup fait tomber
// les navigateurs mobiles a court de memoire.
function b64ToBytes(b64) {
  const CHUNK = 1 << 20;
  const out = new Uint8Array(Math.floor(b64.length / 4) * 3);
  let offset = 0;
  for (let i = 0; i < b64.length; i += CHUNK) {
    let slice = b64.slice(i, i + CHUNK);
    const binary = atob(slice);
    for (let j = 0; j < binary.length; j++) out[offset++] = binary.charCodeAt(j);
  }
  return out.subarray(0, offset);
}

async function gunzip(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Ce navigateur ne sait pas decompresser (DecompressionStream absent).");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Le chargeur de Godot va chercher index.wasm et index.pck avec fetch().
// On les lui sert depuis la memoire : aucune requete ne quitte la page.
function installFetchShim(files) {
  const original = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = (typeof input === "string" ? input : input.url) || "";
    for (const name in files) {
      if (url.endsWith(name)) {
        return Promise.resolve(new Response(files[name], {
          status: 200,
          headers: { "Content-Type": name.endsWith(".wasm")
            ? "application/wasm" : "application/octet-stream" },
        }));
      }
    }
    return original(input, init);
  };
}

async function boot() {
  try {
    setStatus("La vallee se reveille\\u2026", 10);
    const gz = b64ToBytes(WASM_GZ_B64);
    setStatus("Les fougeres poussent\\u2026", 35);
    const wasm = await gunzip(gz);
    setStatus("SORIO enfile son echarpe\\u2026", 65);
    const pck = b64ToBytes(PCK_B64);

    installFetchShim({ "index.wasm": wasm, "index.pck": pck });
    setStatus("PIKO ouvre le chemin\\u2026", 85);

    const engine = new Engine(GODOT_CONFIG);
    // Un premier geste de l'utilisateur est requis pour l'audio et le
    // plein ecran : on attend le clic plutot que de demarrer en silence.
    playEl.hidden = false;
    setStatus("Tout est pret.", 100);
    playEl.addEventListener("click", async () => {
      playEl.disabled = true;
      bootEl.remove();
      try {
        await engine.startGame({ canvas: document.getElementById("canvas") });
        document.getElementById("canvas").focus();
      } catch (err) {
        document.body.insertAdjacentHTML("afterbegin",
          "<pre class='err'>" + String(err) + "</pre>");
      }
    }, { once: true });
  } catch (err) {
    setStatus("Le chargement a echoue : " + String(err));
  }
}
</script>

<script>
%(engine_js)s
</script>

<script>boot();</script>
"""


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    source = Path(sys.argv[1])
    target = Path(sys.argv[2])

    wasm = (source / "index.wasm").read_bytes()
    pck = (source / "index.pck").read_bytes()
    engine_js = (source / "index.js").read_text(encoding="utf-8")

    print(f"  wasm brut   : {len(wasm) / 1048576:.1f} Mo")
    packed = gzip.compress(wasm, 9)
    print(f"  wasm gzip   : {len(packed) / 1048576:.1f} Mo")

    config = {
        "args": [],
        "canvasResizePolicy": 2,
        "executable": "index",
        "experimentalVK": False,
        "fileSizes": {"index.pck": len(pck), "index.wasm": len(wasm)},
        "focusCanvas": True,
        "gdextensionLibs": [],
    }

    worklets = {}
    for name in ("index.audio.worklet.js", "index.audio.position.worklet.js"):
        path = source / name
        if path.exists():
            worklets[name] = path.read_text(encoding="utf-8")

    html = TEMPLATE % {
        "worklets": json.dumps(worklets),
        "wasm": base64.b64encode(packed).decode("ascii"),
        "pck": base64.b64encode(pck).decode("ascii"),
        "config": json.dumps(config),
        "engine_js": engine_js,
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(html, encoding="utf-8")
    size = target.stat().st_size / 1048576
    print(f"  page finale : {size:.1f} Mo -> {target}")
    if size > 16.0:
        print("  ATTENTION : au-dela de la limite de 16 Mo d'une page publiee.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
