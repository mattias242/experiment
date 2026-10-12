// Ansiktsspårningen: frontkameran och MediaPipes ansiktsmodell.
//
// Allt körs i webbläsaren. Kamerabilden lämnar aldrig telefonen – det som
// hämtas utifrån är själva programbiblioteket (jsDelivr) och modellfilen
// (Google), en gång.
'use strict';

const MEDIAPIPE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35';
const ANSIKTSMODELL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

class Ansiktssparning {
  // narResultat({ landmarken, bredd, hojd, tid }) anropas för varje
  // kamerabild; landmarken är null när inget ansikte syns.
  // narLage(lage, detalj) berättar hur starten går.
  constructor(video, { narResultat, narLage }) {
    this.video = video;
    this.narResultat = narResultat;
    this.narLage = narLage;
    this.aktiv = false;
    this.landmarker = null;
    this.senasteBild = -1;
  }

  async starta() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const fel = new Error('Kameran går bara att använda när sidan öppnas via https.');
      fel.name = 'IngenKamera';
      throw fel;
    }
    this.narLage('startar');
    // Modellen laddas medan användaren svarar på frågan om kameran.
    const modell = this.laddaModell();
    modell.catch(() => {}); // felet tas om hand nedan, efter kameran
    const strom = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    });
    this.strom = strom;
    const v = this.video;
    v.muted = true;
    v.playsInline = true;
    v.srcObject = strom;
    await v.play();
    this.narLage('modell');
    this.landmarker = await modell;
    this.aktiv = true;
    this.narLage('letar');
    this.nasta();
  }

  async laddaModell() {
    const vision = await import(`${MEDIAPIPE}/vision_bundle.mjs`);
    const filer = await vision.FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`);
    const skapa = (delegate) => vision.FaceLandmarker.createFromOptions(filer, {
      baseOptions: { modelAssetPath: ANSIKTSMODELL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    this.skapa = skapa;
    // Grafikprocessorn är snabbast men fungerar inte på alla telefoner; då
    // får processorn ta det.
    try {
      const lm = await skapa('GPU');
      this.delegat = 'GPU';
      return lm;
    } catch (e) {
      this.delegat = 'CPU';
      return skapa('CPU');
    }
  }

  // Grafikdelegaten kan också gå sönder först när den används. Då byts den
  // mot processorn, en gång.
  async bytTillProcessorn() {
    this.aktiv = false;
    try { this.landmarker.close(); } catch { /* redan stängd */ }
    this.landmarker = await this.skapa('CPU');
    this.delegat = 'CPU';
    this.aktiv = true;
    this.nasta();
  }

  nasta() {
    if (!this.aktiv) return;
    const v = this.video;
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => this.steg());
    else requestAnimationFrame(() => this.steg());
  }

  steg() {
    if (!this.aktiv) return;
    const v = this.video;
    if (!document.hidden && v.readyState >= 2 && v.currentTime !== this.senasteBild) {
      this.senasteBild = v.currentTime;
      const tid = performance.now();
      let resultat = null;
      try {
        resultat = this.landmarker.detectForVideo(v, tid);
      } catch (e) {
        if (this.delegat === 'GPU') {
          this.bytTillProcessorn().catch((fel) => { this.narLage('fel', fel); this.stoppa(); });
        } else {
          this.narLage('fel', e);
          this.stoppa();
        }
        return;
      }
      const landmarken = resultat.faceLandmarks && resultat.faceLandmarks[0];
      this.narResultat({ landmarken: landmarken || null, bredd: v.videoWidth, hojd: v.videoHeight, tid });
    }
    this.nasta();
  }

  stoppa() {
    this.aktiv = false;
    if (this.strom) this.strom.getTracks().forEach((t) => t.stop());
    this.strom = null;
  }
}

window.Ansiktssparning = Ansiktssparning;
