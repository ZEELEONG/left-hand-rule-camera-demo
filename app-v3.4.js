const video = document.querySelector("#camera");
const canvas = document.querySelector("#overlay");
const ctx = canvas.getContext("2d");
const shell = document.querySelector(".camera-shell");
const button = document.querySelector("#cameraButton");
const mirrorButton = document.querySelector("#mirrorButton");
const statusText = document.querySelector("#statusText");
const trackingDot = document.querySelector("#trackingDot");

const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

const state = {
  detector: null,
  detectorBusy: false,
  firstResultSeen: false,
  three: null,
  running: false,
  lastVideoTime: -1,
  lastDetectAt: 0,
  hand: null,
  handIssue: "",
  gestureScore: 0,
  modelReady: false,
  phase: 0,
  mirrored: false,
};

const HANDS_ASSET_PATH = "./vendor/hands";
const HANDS_SCRIPT_URL = `${HANDS_ASSET_PATH}/hands.js`;

const THREE_SOURCES = [
  "./vendor/three/three.module.js",
];

const MODULE_IMPORT_TIMEOUT = 90000;
const HANDS_SEND_TIMEOUT = 20000;
const FIRST_HANDS_SEND_TIMEOUT = 120000;
const DETECT_INTERVAL_MS = 90;

button.addEventListener("click", start);
mirrorButton.addEventListener("click", toggleMirror);
window.addEventListener("resize", resizeCanvas);
applyMirrorState();

function toggleMirror() {
  state.mirrored = !state.mirrored;
  applyMirrorState();
}

function applyMirrorState() {
  shell.classList.toggle("mirrored", state.mirrored);
  mirrorButton.classList.toggle("active", state.mirrored);
  mirrorButton.setAttribute("aria-pressed", String(state.mirrored));
  mirrorButton.querySelector("span:last-child").textContent = state.mirrored
    ? "当前：镜像"
    : "当前：原始";
}

async function start() {
  button.disabled = true;
  applyMirrorState();
  setStatus("正在启动摄像头和手部识别模型，微信首次加载可能需要 30-90 秒", false);

  try {
    await setupCamera();
    await setupThree();
    await setupHandDetector();
    state.running = true;
    button.querySelector("span:last-child").textContent = "摄像头已开启";
    button.querySelector(".button-icon").textContent = "●";
    setStatus("请展开左手：四指指向电流 I，穿入掌心表示磁场 B，拇指张开表示安培力 F", false);
    requestAnimationFrame(loop);
  } catch (error) {
    console.error(error);
    button.disabled = false;
    setStatus(error.message || "启动失败，请检查浏览器权限", false);
  }
}

async function setupCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前浏览器不支持摄像头调用");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
    audio: false,
  });

  video.srcObject = stream;
  await video.play();
  resizeCanvas();
}

async function setupHandDetector() {
  if (state.detector) return;

  try {
    setStatus("识别模型加载中：MediaPipe Hands（微信兼容版）", false);
    await loadScriptWithTimeout(HANDS_SCRIPT_URL, MODULE_IMPORT_TIMEOUT);
    if (!window.Hands) {
      throw new Error("MediaPipe Hands 脚本加载后未注册");
    }

    const hands = new window.Hands({
      locateFile: (file) => `${HANDS_ASSET_PATH}/${file}`,
    });
    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 0,
      useCpuInference: true,
      selfieMode: false,
      minDetectionConfidence: 0.35,
      minTrackingConfidence: 0.35,
    });
    hands.onResults((result) => {
      const landmarksList = result?.multiHandLandmarks || [];
      state.firstResultSeen = true;
      const picked = pickLeftHand(result);
      state.hand = picked.hand;
      state.handIssue = picked.issue;
      state.gestureScore = state.hand ? scoreOpenPalmRule(state.hand) : 0;
      state.detectorBusy = false;
    });

    state.detector = hands;
    state.modelReady = true;
  } catch (error) {
    console.warn("MediaPipe Hands setup failed", error);
    throw new Error(`手部识别模型加载失败。微信内置浏览器若首次失败，请关闭页面重新打开；若仍失败，可换 Safari/Chrome。${error.message || error}`);
  }
}

function importWithTimeout(url, timeoutMs) {
  return withTimeout(import(url), timeoutMs, `加载超时：${url}`);
}

function loadScriptWithTimeout(url, timeoutMs) {
  if (document.querySelector(`script[data-loader-url="${url}"]`)) {
    return Promise.resolve();
  }

  return withTimeout(new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.dataset.loaderUrl = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`脚本加载失败：${url}`));
    document.head.appendChild(script);
  }), timeoutMs, `脚本加载超时：${url}`);
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timer);
  });
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  resizeThree();
}

async function setupThree() {
  if (state.three) return;

  const THREE = await loadThree();
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.id = "threeOverlay";
  shell.insertBefore(renderer.domElement, canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 1, 5000);
  camera.position.set(0, 0, 900);
  camera.lookAt(0, 0, 0);

  const axisGroup = new THREE.Group();
  scene.add(axisGroup);

  state.three = {
    THREE,
    renderer,
    scene,
    camera,
    axisGroup,
    arrows: {
      i: createArrow3D(THREE, 0x52c7e8),
      f: createArrow3D(THREE, 0xffce5c),
      b: Array.from({ length: 9 }, () => createArrow3D(THREE, 0xf06a77, 0.72)),
    },
  };

  axisGroup.add(state.three.arrows.i.group);
  axisGroup.add(state.three.arrows.f.group);
  for (const arrow of state.three.arrows.b) axisGroup.add(arrow.group);
  resizeThree();
}

async function loadThree() {
  const failures = [];
  for (const url of THREE_SOURCES) {
    try {
      return await importWithTimeout(url, MODULE_IMPORT_TIMEOUT);
    } catch (error) {
      failures.push(`${url}: ${error.message || error}`);
    }
  }
  throw new Error(`Three.js 加载失败，请检查网络。${failures.join(" | ")}`);
}

function resizeThree() {
  if (!state.three) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  state.three.renderer.setPixelRatio(dpr);
  state.three.renderer.setSize(rect.width, rect.height, false);
  state.three.camera.aspect = rect.width / rect.height || 1;
  state.three.camera.updateProjectionMatrix();
}

function loop(now) {
  if (!state.running) return;

  if (shouldSendFrame(now)) {
    state.lastVideoTime = video.currentTime;
    state.lastDetectAt = now;
    state.detectorBusy = true;
    withTimeout(
      state.detector.send({ image: video }),
      state.firstResultSeen ? HANDS_SEND_TIMEOUT : FIRST_HANDS_SEND_TIMEOUT,
      "单帧识别超时"
    ).catch((error) => {
      console.warn("MediaPipe Hands frame failed", error);
      state.detectorBusy = false;
    });
  }

  draw(now);
  requestAnimationFrame(loop);
}

function shouldSendFrame(now) {
  return state.detector &&
    !state.detectorBusy &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0 &&
    now - state.lastDetectAt >= DETECT_INTERVAL_MS;
}

function pickLeftHand(result) {
  const landmarksList = result?.landmarks || result?.multiHandLandmarks;
  if (!landmarksList?.length) return { hand: null, issue: "" };

  const handedness = result.handednesses || result.handedness || result.multiHandedness || [];
  let bestLeft = null;
  let bestRight = null;
  for (let i = 0; i < landmarksList.length; i += 1) {
    const handed = Array.isArray(handedness[i]) ? handedness[i][0] : handedness[i];
    const label = handed?.categoryName || handed?.label;
    const score = handed?.score ?? 0;
    const world = result.worldLandmarks?.[i] || result.multiHandWorldLandmarks?.[i];
    const visualScore = visualLeftHandScore(landmarksList[i]);
    const hand = { landmarks: landmarksList[i], world, label, score, visualScore };
    if (visualScore < 0.08) {
      if (!bestLeft || visualScore < bestLeft.visualScore) bestLeft = hand;
    } else if (!bestRight || visualScore > bestRight.visualScore) {
      bestRight = hand;
    }
  }

  if (bestLeft) return { hand: bestLeft, issue: "" };
  if (bestRight) return { hand: null, issue: "识别到右手，请抬起左手" };
  return { hand: null, issue: "请抬起左手" };
}

function visualLeftHandScore(points) {
  const x = (index) => state.mirrored ? 1 - points[index].x : points[index].x;
  const thumbX = (x(2) + x(3) + x(4)) / 3;
  const fingerCenterX = (x(5) + x(9) + x(13) + x(17)) / 4;
  const palmWidth = Math.max(Math.abs(x(17) - x(5)), 0.04);
  return (thumbX - fingerCenterX) / palmWidth;
}

function scoreOpenPalmRule(hand) {
  const p = hand.landmarks;
  const thumb = fingerExtended(p, 2, 3, 4, 0.88);
  const index = fingerExtended(p, 5, 6, 8, 1.05);
  const middle = fingerExtended(p, 9, 10, 12, 1.05);
  const ring = fingerExtended(p, 13, 14, 16, 1.0);
  const pinky = fingerExtended(p, 17, 18, 20, 0.95);

  const thumbVec = vector3(p[2], p[4]);
  const fingerVec = averageVector(
    vector3(p[5], p[8]),
    vector3(p[9], p[12]),
    vector3(p[13], p[16]),
    vector3(p[17], p[20])
  );
  const thumbOpen = separationScore(thumbVec, fingerVec, 35, 125);
  const fingersAligned =
    alignmentScore(vector3(p[5], p[8]), fingerVec) * 0.25 +
    alignmentScore(vector3(p[9], p[12]), fingerVec) * 0.25 +
    alignmentScore(vector3(p[13], p[16]), fingerVec) * 0.25 +
    alignmentScore(vector3(p[17], p[20]), fingerVec) * 0.25;

  return (
    Number(thumb) * 0.12 +
    Number(index) * 0.16 +
    Number(middle) * 0.16 +
    Number(ring) * 0.16 +
    Number(pinky) * 0.14 +
    thumbOpen * 0.15 +
    fingersAligned * 0.11
  );
}

function fingerExtended(p, base, joint, tip, ratio) {
  const wrist = p[0];
  return distance3d(p[tip], wrist) > distance3d(p[joint], wrist) * ratio &&
    distance3d(p[tip], p[base]) > distance3d(p[joint], p[base]) * 1.16;
}

function separationScore(a, b, minDeg, maxDeg) {
  const angle = angleBetween(a, b);
  if (angle < minDeg) return angle / minDeg;
  if (angle > maxDeg) return Math.max(0, 1 - (angle - maxDeg) / 60);
  return 1;
}

function alignmentScore(a, b) {
  const angle = angleBetween(a, b);
  return clamp(1 - angle / 45, 0, 1);
}

function angleBetween(a, b) {
  const mag = (Math.hypot(a.x, a.y, a.z || 0) || 1) * (Math.hypot(b.x, b.y, b.z || 0) || 1);
  const cos = clamp((a.x * b.x + a.y * b.y + (a.z || 0) * (b.z || 0)) / mag, -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

function draw(now) {
  const { width, height } = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, width, height);

  if (!state.hand) {
    setThreeVisible(false);
    setStatus(state.modelReady ? state.handIssue || "未检测到左手" : "正在加载识别模型", false);
    drawGuide(width, height, now);
    renderThree();
    return;
  }

  const points = state.hand.landmarks.map((point) => toCanvasPoint(point, width, height));
  drawSkeleton(points);

  if (state.gestureScore < 0.72) {
    setThreeVisible(false);
    setStatus("调整为张开姿态：四指并拢伸直，拇指自然张开", false);
    drawPromptRing(points[0], now);
    renderThree();
    return;
  }

  setStatus("已锁定左手定律张掌姿态", true);
  drawPhysicsOverlay(points, now);
  renderThree();
}
function toCanvasPoint(point, width, height) {
  const x = state.mirrored ? 1 - point.x : point.x;
  return {
    x: x * width,
    y: point.y * height,
    z: (point.z || 0) * width,
  };
}

function drawSkeleton(points) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.strokeStyle = "rgba(245, 241, 232, 0.48)";
    ctx.lineWidth = 3;
    line(points[a], points[b]);
  }
  for (const p of points) {
    ctx.beginPath();
    ctx.fillStyle = "rgba(148, 214, 211, 0.82)";
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPhysicsOverlay(points, now) {
  if (!state.three) return;

  const palm = average(points[0], points[5], points[9], points[13], points[17]);
  const fingerBase = average(points[5], points[9], points[13], points[17]);
  const fingerTips = average(points[8], points[12], points[16], points[20]);
  const thumbTip = points[4];
  const handScale = clamp(distance(points[0], points[9]) * 1.45, 76, 170);
  const palm3 = toWorldPoint(palm);
  const wrist3 = toWorldPoint(points[0]);
  const indexBase3 = toWorldPoint(points[5]);
  const pinkyBase3 = toWorldPoint(points[17]);
  const fingerBase3 = toWorldPoint(fingerBase);
  const fingerTips3 = toWorldPoint(fingerTips);
  const thumbTip3 = toWorldPoint(thumbTip);
  const worldScale = worldUnitsPerPixel();
  const arrowLength = handScale * worldScale;

  const palmAcross = sub3(pinkyBase3, indexBase3);
  const palmUp = sub3(fingerBase3, wrist3);
  const palmNormal = normalize3(crossVec3(palmAcross, palmUp));
  const rawFingerDirection = sub3(fingerTips3, fingerBase3);
  const iUnit = normalize3(rejectAlongVec3(rawFingerDirection, palmNormal));
  const mainArrowLength = arrowLength * 1.5;
  const iLabelOffset = mainArrowLength * 0.2;
  const fLabelOffset = mainArrowLength * 0.4;
  const bLength = arrowLength * 0.84;
  const bLabelOffset = arrowLength * 0.22;

  const iStart = fingerBase3;
  const iEnd = add3(fingerBase3, scaleVec3(iUnit, mainArrowLength * 0.98));
  const thumbInPalmPlane = rejectAlongVec3(sub3(thumbTip3, iStart), palmNormal);
  const rotatedA = normalize3(crossVec3(palmNormal, iUnit));
  const rotatedB = scaleVec3(rotatedA, -1);
  const fUnit = dot3(thumbInPalmPlane, rotatedA) >= dot3(thumbInPalmPlane, rotatedB)
    ? rotatedA
    : rotatedB;
  const bUnit = normalize3(crossVec3(iUnit, fUnit));
  const gridI = scaleVec3(iUnit, arrowLength * 0.4);
  const gridF = scaleVec3(fUnit, arrowLength * 0.44);
  const fStart = iStart;
  const fEnd = add3(fStart, scaleVec3(fUnit, mainArrowLength * 0.9));

  updateArrow3D(state.three.arrows.i, iStart, iEnd);
  updateArrow3D(state.three.arrows.f, fStart, fEnd);

  let index = 0;
  for (let r = -1; r <= 1; r += 1) {
    for (let c = -1; c <= 1; c += 1) {
      const planePoint = add3(palm3, add3(scaleVec3(gridF, r), scaleVec3(gridI, c)));
      updateArrow3D(
        state.three.arrows.b[index],
        add3(planePoint, scaleVec3(bUnit, bLength)),
        planePoint
      );
      index += 1;
    }
  }

  setThreeVisible(true);
  drawLabel(projectWorld(add3(iEnd, scaleVec3(iUnit, iLabelOffset))), "#52c7e8", "", "四指：电流");
  drawLabel(projectWorld(add3(fEnd, scaleVec3(fUnit, fLabelOffset))), "#ffce5c", "", "拇指：安培力");
  drawLabel(
    projectWorld(add3(palm3, scaleVec3(bUnit, bLength + bLabelOffset))),
    "#f06a77",
    "",
    "穿入掌心：磁场"
  );
  drawThumbAnchor(thumbTip, "#ffce5c", now);
}

function createArrow3D(THREE, color, scale = 1) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color,
    depthTest: true,
    depthWrite: false,
  });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.1 * scale, 2.1 * scale, 1, 18), material);
  const head = new THREE.Mesh(new THREE.ConeGeometry(8.5 * scale, 22 * scale, 24), material);
  group.add(shaft, head);
  group.visible = false;
  return { group, head, shaft, headLength: 22 * scale };
}

function updateArrow3D(arrow, start, end) {
  const THREE = state.three.THREE;
  const direction = new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z);
  const length = direction.length();
  if (length < 0.001) {
    arrow.group.visible = false;
    return;
  }

  const headLength = Math.min(arrow.headLength, length * 0.45);
  const shaftLength = Math.max(length - headLength, length * 0.2);
  arrow.group.visible = true;
  arrow.group.position.set(start.x, start.y, start.z);
  arrow.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());

  arrow.shaft.scale.set(1, shaftLength, 1);
  arrow.shaft.position.set(0, shaftLength / 2, 0);
  arrow.head.scale.set(
    headLength / arrow.headLength,
    headLength / arrow.headLength,
    headLength / arrow.headLength
  );
  arrow.head.position.set(0, shaftLength + headLength / 2, 0);
}

function setThreeVisible(visible) {
  if (!state.three) return;
  state.three.axisGroup.visible = visible;
}

function renderThree() {
  if (!state.three) return;
  state.three.renderer.render(state.three.scene, state.three.camera);
}

function toWorldPoint(point) {
  const rect = canvas.getBoundingClientRect();
  const { width, height } = viewSizeAtZ(0);
  const worldPerPixelX = width / rect.width;
  const worldPerPixelY = height / rect.height;
  return {
    x: (point.x - rect.width / 2) * worldPerPixelX,
    y: (rect.height / 2 - point.y) * worldPerPixelY,
    z: -point.z * worldPerPixelX * 1.35,
  };
}

function projectWorld(point) {
  const THREE = state.three.THREE;
  const rect = canvas.getBoundingClientRect();
  const vector = new THREE.Vector3(point.x, point.y, point.z).project(state.three.camera);
  return {
    x: (vector.x * 0.5 + 0.5) * rect.width,
    y: (-vector.y * 0.5 + 0.5) * rect.height,
  };
}

function viewSizeAtZ(z) {
  const camera = state.three.camera;
  const distance = Math.abs(camera.position.z - z);
  const height = 2 * Math.tan((camera.fov * Math.PI) / 360) * distance;
  return { width: height * camera.aspect, height };
}

function worldUnitsPerPixel() {
  const rect = canvas.getBoundingClientRect();
  return viewSizeAtZ(0).width / rect.width;
}

function drawPalmField(center, bUnit3, handScale, now) {
  const screenStrength = Math.hypot(bUnit3.x, bUnit3.y);
  const screenUnit = screenStrength > 0.02
    ? { x: bUnit3.x / screenStrength, y: bUnit3.y / screenStrength }
    : { x: 0, y: 0 };
  const projectedLength = clamp(handScale * 0.44 * screenStrength, 4, handScale * 0.44);
  const row = perpendicular2(screenUnit, handScale * 0.23);
  const col = { x: screenUnit.x * handScale * 0.22, y: screenUnit.y * handScale * 0.22 };

  ctx.save();
  ctx.strokeStyle = "#f06a77";
  ctx.fillStyle = "rgba(240, 106, 119, 0.15)";
  ctx.lineWidth = 3;

  let labelPlaced = false;
  for (let r = -1; r <= 1; r += 1) {
    for (let c = -1; c <= 1; c += 1) {
      const end = {
        x: center.x + row.x * r + col.x * c,
        y: center.y + row.y * r + col.y * c,
      };
      const start = {
        x: end.x + screenUnit.x * projectedLength,
        y: end.y + screenUnit.y * projectedLength,
      };
      const isCenter = r === 0 && c === 0;
      if (projectedLength <= 8) {
        drawFieldDot(end, "#f06a77", isCenter && !labelPlaced);
      } else {
        drawArrow(start, end, "#f06a77", isCenter ? "B" : "", isCenter ? "磁场" : "", now, r + c + 4, {
          labelAt: "start",
          lineWidth: 3,
          pulse: false,
        });
      }
      if (isCenter) labelPlaced = true;
    }
  }

  ctx.restore();
}

function drawFieldDot(point, color, withLabel) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (withLabel) {
    drawLabel({ x: point.x + 8, y: point.y - 8 }, color, "B", "磁场");
  }
  ctx.restore();
}

function drawThumbAnchor(point, color, now) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = "rgba(255, 206, 92, 0.2)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 11 + Math.sin(now * 0.006) * 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawArrow(start, end, color, symbol, text, now = 0, offset = 0, options = {}) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const lineWidth = options.lineWidth ?? 4;
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.shadowBlur = 0;
  ctx.lineWidth = lineWidth;
  line(start, end);

  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - 22 * Math.cos(angle - 0.45), end.y - 22 * Math.sin(angle - 0.45));
  ctx.lineTo(end.x - 22 * Math.cos(angle + 0.45), end.y - 22 * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();

  if (options.pulse !== false) {
    drawArrowPulse(start, end, color, now, offset);
  }
  drawLabel(options.labelAt === "start" ? start : end, color, symbol, text);
  ctx.restore();
}

function drawArrowPulse(start, end, color, now, offset) {
  const t = ((now * 0.0012 + offset * 0.22) % 1) * 0.82 + 0.09;
  const x = start.x + (end.x - start.x) * t;
  const y = start.y + (end.y - start.y) * t;
  ctx.fillStyle = color;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
}

function drawAxisPlane(origin, ends) {
  ctx.save();
  ctx.fillStyle = "rgba(245, 241, 232, 0.08)";
  ctx.strokeStyle = "rgba(245, 241, 232, 0.24)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  for (const end of ends) ctx.lineTo(end.x, end.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawLabel(point, color, symbol, text) {
  const label = symbol ? `${text}  ${symbol}` : text;
  if (!label.trim()) return;

  ctx.save();
  ctx.font = "800 15px Inter, Microsoft YaHei, sans-serif";
  const metrics = ctx.measureText(label);
  const w = metrics.width + 22;
  const h = 32;
  const x = point.x + 12;
  const y = point.y - 16;

  ctx.fillStyle = "rgba(8, 12, 11, 0.78)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f5f1e8";
  ctx.fillText(label, x + 11, y + 21);
  ctx.restore();
}

function drawHelix(start, end, now) {
  const axis = vector(start, end);
  const len = Math.hypot(axis.x, axis.y);
  if (len < 20) return;

  const unit = { x: axis.x / len, y: axis.y / len };
  const normal = { x: -unit.y, y: unit.x };
  const turns = 4.2;
  const steps = 140;
  const phase = now * 0.006;
  const radius = clamp(len * 0.09, 10, 22);

  ctx.save();
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#ffef9d";
  ctx.shadowBlur = 0;
  ctx.beginPath();
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const spin = t * Math.PI * 2 * turns + phase;
    const wave = Math.sin(spin) * radius;
    const x = start.x + axis.x * t + normal.x * wave;
    const y = start.y + axis.y * t + normal.y * wave;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  for (let i = 0; i < 5; i += 1) {
    const t = ((phase * 0.08 + i / 5) % 1) * 0.88 + 0.06;
    const spin = t * Math.PI * 2 * turns + phase;
    const wave = Math.sin(spin) * radius;
    const p = {
      x: start.x + axis.x * t + normal.x * wave,
      y: start.y + axis.y * t + normal.y * wave,
    };
    ctx.fillStyle = "rgba(255, 206, 92, 0.95)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawMagneticRings(start, end, now) {
  const axis = vector(start, end);
  const len = Math.hypot(axis.x, axis.y);
  if (len < 20) return;

  const unit = { x: axis.x / len, y: axis.y / len };
  const normal = { x: -unit.y, y: unit.x };
  ctx.save();
  ctx.strokeStyle = "rgba(240, 106, 119, 0.72)";
  ctx.lineWidth = 2;
  ctx.shadowBlur = 0;

  for (let i = 0; i < 4; i += 1) {
    const t = 0.22 + i * 0.18;
    const pulse = 0.78 + 0.22 * Math.sin(now * 0.005 + i);
    const center = { x: start.x + axis.x * t, y: start.y + axis.y * t };
    const rx = 22 * pulse;
    const ry = 8 * pulse;

    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.12) {
      const x = center.x + normal.x * Math.cos(a) * rx + unit.x * Math.sin(a) * ry;
      const y = center.y + normal.y * Math.cos(a) * rx + unit.y * Math.sin(a) * ry;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawGuide(width, height, now) {
  const center = { x: width / 2, y: height / 2 + 20 };
  const r = 84 + Math.sin(now * 0.004) * 5;
  ctx.save();
  ctx.strokeStyle = "rgba(245, 241, 232, 0.28)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(245, 241, 232, 0.78)";
  ctx.font = "800 18px Inter, Microsoft YaHei, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("左手张开，四指并拢指向电流 I", center.x, center.y + r + 34);
  ctx.restore();
}

function drawPromptRing(point, now) {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 206, 92, 0.78)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 48 + Math.sin(now * 0.006) * 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function setStatus(text, active) {
  statusText.textContent = text;
  trackingDot.classList.toggle("on", active);
}

function average(...points) {
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    z: points.reduce((sum, p) => sum + (p.z || 0), 0) / points.length,
  };
}

function vector(a, b) {
  return { x: b.x - a.x, y: b.y - a.y };
}

function vector3(a, b) {
  return { x: b.x - a.x, y: b.y - a.y, z: (b.z || 0) - (a.z || 0) };
}

function add3(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: (a.z || 0) + (b.z || 0) };
}

function sub3(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
}

function scaleVec3(v, amount) {
  return { x: v.x * amount, y: v.y * amount, z: (v.z || 0) * amount };
}

function normalize3(v) {
  const mag = Math.hypot(v.x, v.y, v.z || 0) || 1;
  return { x: v.x / mag, y: v.y / mag, z: (v.z || 0) / mag };
}

function rejectAlongVec3(v, axisUnit) {
  const amount = dot3(v, axisUnit);
  return {
    x: v.x - axisUnit.x * amount,
    y: v.y - axisUnit.y * amount,
    z: (v.z || 0) - (axisUnit.z || 0) * amount,
  };
}

function crossVec3(a, b) {
  return {
    x: a.y * (b.z || 0) - (a.z || 0) * b.y,
    y: (a.z || 0) * b.x - a.x * (b.z || 0),
    z: a.x * b.y - a.y * b.x,
  };
}

function averageVector(...vectors) {
  return {
    x: vectors.reduce((sum, v) => sum + v.x, 0) / vectors.length,
    y: vectors.reduce((sum, v) => sum + v.y, 0) / vectors.length,
    z: vectors.reduce((sum, v) => sum + (v.z || 0), 0) / vectors.length,
  };
}

function unitVector(v) {
  const mag = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / mag, y: v.y / mag };
}

function unitVector3(v) {
  const mag = Math.hypot(v.x, v.y, v.z || 0) || 1;
  return { x: v.x / mag, y: v.y / mag, z: (v.z || 0) / mag };
}

function rotate90(v, direction) {
  return direction > 0 ? { x: -v.y, y: v.x } : { x: v.y, y: -v.x };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function rejectAlong(v, axisUnit) {
  const amount = dot(v, axisUnit);
  return {
    x: v.x - axisUnit.x * amount,
    y: v.y - axisUnit.y * amount,
  };
}

function rejectAlong3(v, axisUnit) {
  const amount = dot3(v, axisUnit);
  return {
    x: v.x - axisUnit.x * amount,
    y: v.y - axisUnit.y * amount,
    z: (v.z || 0) - (axisUnit.z || 0) * amount,
  };
}

function dot3(a, b) {
  return a.x * b.x + a.y * b.y + (a.z || 0) * (b.z || 0);
}

function cross(a, b) {
  return {
    x: a.y * (b.z || 0) - (a.z || 0) * b.y,
    y: (a.z || 0) * b.x - a.x * (b.z || 0),
    z: a.x * b.y - a.y * b.x,
  };
}

function perpendicular(v, length) {
  const mag = Math.hypot(v.x, v.y) || 1;
  return { x: (-v.y / mag) * length, y: (v.x / mag) * length };
}

function perpendicular2(v, length) {
  if (!v.x && !v.y) return { x: length, y: 0 };
  return { x: -v.y * length, y: v.x * length };
}

function extend(a, b, length) {
  const v = vector(a, b);
  const mag = Math.hypot(v.x, v.y) || 1;
  return { x: a.x + (v.x / mag) * length, y: a.y + (v.y / mag) * length };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distance3d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

function line(a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


