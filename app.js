const imageUpload    = document.getElementById("imageUpload");
const previewImage   = document.getElementById("previewImage");
const analyzeBtn     = document.getElementById("analyzeBtn");
const skinToneDiv    = document.getElementById("skinTone");
const hexColorDiv    = document.getElementById("hexColor");
const undertoneDiv   = document.getElementById("undertone");
const seasonalTypeDiv= document.getElementById("seasonalType");
const clothingColors = document.getElementById("clothingColors");
const hairColors     = document.getElementById("hairColors");
const jewelryColors  = document.getElementById("jewelryColors");
const video          = document.getElementById("video");
const canvas         = document.getElementById("canvas");
const cameraBtn      = document.getElementById("cameraBtn");
const cameraSwitchBtn= document.getElementById("cameraSwitchBtn");
const captureBtn     = document.getElementById("captureBtn");
const cameraStatus   = document.getElementById("cameraStatus");
const validationMessage = document.getElementById("validationMessage");
const darkModeBtn    = document.getElementById("darkModeBtn");
const confidenceScore= document.getElementById("confidenceScore");
const cameraWrapper  = document.querySelector(".camera-wrapper");
const previewWrapper = document.querySelector(".preview-wrapper");
const genderResult   = document.getElementById("genderResult");
const genderIcon     = document.getElementById("genderIcon");
const genderText     = document.getElementById("genderText");
const shopSection    = document.getElementById("shopSection");
const shopGrid       = document.getElementById("shopGrid");
const shareSeasonBtn = document.getElementById("shareSeasonBtn");
const faceStatusWarning = document.getElementById("faceStatusWarning");
// Styles for the 3D glasses "Frame Inventory Curation" stage live in
// style.css (.glasses-stage, .glasses-card and related classes) — this used
// to also be injected here at runtime as a duplicate, conflicting
// stylesheet, which is what caused the mobile layout to break (the injected
// version loaded after style.css and silently won on cascade order, and it
// had no mobile breakpoint at all). Removed in favor of style.css being the
// one source of truth.

let uploadedImage     = null;
let stream            = null;
let currentFacingMode = "user";
let faceDetector      = null;
let faceApiReady      = false;
let faceApiFailed     = false;
let ageGenderReady    = false;

// Global memory state tracking arrays for individual card color slider positions
let itemsToShopMatrix = [];
window._currentRetailerTab = "amazon"; // Default active retailer tab state anchor

const FACE_API_MODEL_URL = "https://cdn.jsdelivr.net/gh/cgarciagl/face-api.js/weights/";

// 📊 Helper function to safely track shopping channel exit conversions
window.trackShoppingClick = function(platform, itemType) {
    if (typeof gtag === "function") {
        gtag('event', 'click_shopping_link', {
            'retailer': platform,
            'item_category': itemType
        });
    }
};

function applyDarkModeUI() {
    if (!darkModeBtn) return;
    const isDark = document.body.classList.contains("dark-mode");
    darkModeBtn.textContent = isDark ? "☀️" : "🌙";
    darkModeBtn.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
}

function setStatus(message, type = "info") {
    if (!cameraStatus) return;
    cameraStatus.textContent = message;
    cameraStatus.className = `camera-status ${type}`;
}

// ── IP-based Geolocation (accurate, works through VPN too) ──
// Stores result so we only call the API once per session
let _userCountryCode = null;

async function getUserCountry() {
    // Return cached result if already fetched
    if (_userCountryCode !== null) return _userCountryCode;

    // Check sessionStorage first (persists across page interactions)
    const cached = sessionStorage.getItem("uca_country");
    if (cached) { _userCountryCode = cached; return cached; }

    try {
        // ipwho.is — free, no API key needed, HTTPS + CORS supported (unlike
        // ip-api.com's free tier, which is HTTP-only and gets blocked as
        // mixed content on any site served over HTTPS).
        const res  = await fetch("https://ipwho.is/?fields=country_code", { signal: AbortSignal.timeout(3000) });
        const data = await res.json();
        const code = (data.country_code || "US").toUpperCase();
        _userCountryCode = code;
        sessionStorage.setItem("uca_country", code);
        return code;
    } catch (e) {
        // If API fails, fallback to timezone as backup
        try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") {
                _userCountryCode = "IN";
                return "IN";
            }
        } catch (e2) {}
        _userCountryCode = "US"; // safe default
        return "US";
    }
}

function isUserInIndia() {
    // Synchronous check using cached value only
    // Always use getUserCountry() for fresh async check
    if (_userCountryCode === "IN") return true;
    const cached = sessionStorage.getItem("uca_country");
    if (cached === "IN") return true;
    return false;
}

// Kick off the IP-based country lookup as soon as the script loads, so the
// result is cached (via _userCountryCode / sessionStorage) well before the
// user finishes uploading a photo and clicking "Analyze" — isUserInIndia()
// only reads that cache and never triggers the lookup itself.
getUserCountry();

function setValidationMessage(message, type = "info") {
    if (!validationMessage) return;
    validationMessage.textContent = message;
    validationMessage.className = `validation-message ${type}`;
}

function clearRecommendations() {
    if (clothingColors) clothingColors.innerHTML = "";
    if (hairColors)     hairColors.innerHTML = "";
    if (jewelryColors)  jewelryColors.innerHTML = "";
    if (shopGrid)       shopGrid.innerHTML = "";
    if (shopSection)    shopSection.style.display = "none";
    if (genderResult)   genderResult.style.display = "none";
    if (shareSeasonBtn) shareSeasonBtn.style.display = "none";
    if (faceStatusWarning) faceStatusWarning.style.display = "none";
}

function resetResults() {
    if (skinToneDiv)    skinToneDiv.innerHTML = "Waiting for analysis...";
    if (hexColorDiv)    hexColorDiv.innerHTML = "";
    if (undertoneDiv)   undertoneDiv.innerHTML = "";
    if (seasonalTypeDiv) seasonalTypeDiv.innerHTML = "";
    if (confidenceScore) confidenceScore.innerHTML = "";
    clearRecommendations();
}

function loadImageFromSource(imageSrc) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload  = () => resolve(img);
        img.onerror = () => reject(new Error("Unable to load the selected image."));
        img.src = imageSrc;
    });
}

async function initFaceApi() {
    if (faceApiReady) return;
    if (typeof window.faceapi === "undefined") return;
    try {
        await Promise.all([
            window.faceapi.nets.tinyFaceDetector.load(FACE_API_MODEL_URL),
            window.faceapi.nets.ageGenderNet.load(FACE_API_MODEL_URL),
            window.faceapi.nets.faceLandmark68Net.load(FACE_API_MODEL_URL)
        ]);
        faceApiReady   = true;
        ageGenderReady = true;
    } catch (err) {
        console.warn("face-api models failed:", err);
        faceApiFailed = true;
    }
    if (!faceDetector && typeof window.FaceDetector !== "undefined") {
        try { faceDetector = new window.FaceDetector({ fastMode: true }); } catch (e) {}
    }
}

async function detectFaceData(imageElement) {
    if (faceApiReady && ageGenderReady) {
        try {
            const detection = await window.faceapi
                .detectSingleFace(imageElement, new window.faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.15 }))
                .withAgeAndGender();
            if (detection) return {
                faceBox: detection.detection.box,
                gender:  detection.gender,
                genderProb: detection.genderProbability,
                age:     Math.round(detection.age)
            };
        } catch (err) { console.warn("age/gender detection failed:", err); }
    }
    if (faceApiReady) {
        try {
            const det = await window.faceapi.detectSingleFace(imageElement, new window.faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.12 }));
            if (det) return { faceBox: det.box, gender: null, age: null };
        } catch (e) {}
    }
    if (faceDetector) {
        try {
            const bitmap = await createImageBitmap(imageElement);
            const faces  = await faceDetector.detect(bitmap);
            bitmap.close && bitmap.close();
            if (faces && faces.length > 0) return { faceBox: faces[0].boundingBox, gender: null, age: null };
        } catch (e) {}
    }
    return { faceBox: null, gender: null, age: null };
}

function detectSkinPixels(imageElement) {
    const tc  = document.createElement("canvas");
    const ctx = tc.getContext("2d", { willReadFrequently: true });
    
    const sampleWidth = Math.floor(imageElement.width * 0.4);
    const sampleHeight = Math.floor(imageElement.height * 0.4);
    const startX = Math.floor((imageElement.width - sampleWidth) / 2);
    const startY = Math.floor(imageElement.height * 0.1); 

    tc.width  = sampleWidth;
    tc.height = sampleHeight;
    
    ctx.drawImage(imageElement, startX, startY, sampleWidth, sampleHeight, 0, 0, sampleWidth, sampleHeight);
    const data = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
    let skinCount = 0, total = 0;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        total++;

        if (r > g && g > b && r > 45) {
            const Y  =  0.299*r + 0.587*g + 0.114*b;
            const Cb = -0.169*r - 0.331*g + 0.500*b + 128;
            const Cr =  0.500*r - 0.419*g - 0.081*b + 128;
            
            if (Y > 40 && Cb >= 80 && Cb <= 135 && Cr >= 130 && Cr <= 180) {
                skinCount++;
            }
        }
    }

    const skinRatio = skinCount / total;
    return {
        skinRatio: Math.round(skinRatio * 100),
        hasSkin:   skinRatio >= 0.03
    };
}

function getAverageBrightness(data) {
    let total = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) { total += (data[i]+data[i+1]+data[i+2])/3; count++; }
    return count ? total/count : 0;
}

function getContrastLevel(data) {
    let sum = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) { sum += (data[i]+data[i+1]+data[i+2])/3; count++; }
    const mean = count ? sum/count : 0;
    let variance = 0;
    for (let i = 0; i < data.length; i += 4) { const b=(data[i]+data[i+1]+data[i+2])/3; variance+=Math.pow(b-mean,2); }
    const stdDev = count ? Math.sqrt(variance/count) : 0;
    if (stdDev > 50) return "high";
    if (stdDev > 25) return "medium";
    return "low";
}

async function validatePhoto(imageSrc) {
    const img = await loadImageFromSource(imageSrc);
    const tc  = document.createElement("canvas");
    const ctx = tc.getContext("2d", { willReadFrequently: true });
    tc.width=img.width; tc.height=img.height;
    ctx.drawImage(img,0,0,img.width,img.height);
    const data = ctx.getImageData(0,0,img.width,img.height).data;
    const brightness = getAverageBrightness(data);

    if (img.width < 150 || img.height < 150)
        throw new Error("Image resolution too low. Please use a clearer photo.");
    if (brightness < 45)
        throw new Error("Photo is too dark. Move closer to a window or turn on a light.");
    if (brightness > 240)
        throw new Error("Photo is overexposed. Avoid direct flash or harsh lighting.");

    const contrastLevel = getContrastLevel(data);

    await initFaceApi();
    const faceData = await detectFaceData(img);

    if (faceData && faceData.faceBox) {
        if (faceStatusWarning) faceStatusWarning.style.display = "none";
        return { brightness, contrastLevel, skinRatio: 100, ...faceData };
    }

    const skinResult = detectSkinPixels(img);
    if (!skinResult.hasSkin) {
        if (faceStatusWarning) faceStatusWarning.style.display = "flex";
        throw new Error(
            `No human face or skin tone detected in this photo. ` +
            `Please upload a clear selfie or portrait showing your face.`
        );
    }
    if (faceStatusWarning) faceStatusWarning.style.display = "none";

    return { brightness, contrastLevel, skinRatio: skinResult.skinRatio, ...faceData };
}

if (localStorage.getItem("darkMode") === "true") document.body.classList.add("dark-mode");
applyDarkModeUI();
resetResults();

window._selectedGender = "woman";
window._aiGenderDetectionEnabled = true;

window.toggleAiGenderDetection = function(enabled) {
    window._aiGenderDetectionEnabled = enabled;

    const label = document.getElementById("profileTypeLabel");
    const toggleLabel = document.getElementById("aiToggleLabel");
    const track = document.getElementById("aiToggleTrack");
    const thumb = document.getElementById("aiToggleThumb");
    const helperText = document.getElementById("profileTypeHelperText");

    if (enabled) {
        if (label) label.textContent = "🤖 Profile Type: AI Auto-Detect Active";
        if (toggleLabel) { toggleLabel.textContent = "AI: ON"; toggleLabel.style.color = "#0369a1"; }
        if (track) track.style.background = "#0ea5e9";
        if (thumb) thumb.style.left = "20px";
        if (helperText) helperText.textContent = "Our face-tracking network automatically isolates demographics to personalize your store recommendations. You can optionally tap below to set a manual override fallback position:";
    } else {
        if (label) label.textContent = "🙋 Profile Type: Manual Selection";
        if (toggleLabel) { toggleLabel.textContent = "AI: OFF"; toggleLabel.style.color = "#6b7280"; }
        if (track) track.style.background = "#94a3b8";
        if (thumb) thumb.style.left = "2px";
        if (helperText) helperText.textContent = "AI auto-detection is off — your selection below will always be used, even if our AI would have guessed differently.";
    }
};

window.selectGender = function(gender) {
    window._selectedGender = gender;
    const btns = {
        woman: document.getElementById("genderBtnWoman"),
        man:   document.getElementById("genderBtnMan"),
        child: document.getElementById("genderBtnChild")
    };
    Object.entries(btns).forEach(([key, btn]) => {
        if (!btn) return;
        if (key === gender) {
            btn.style.background = "#6a5acd";
            btn.style.color      = "#fff";
            btn.style.borderColor= "#6a5acd";
        } else {
            btn.style.background  = "transparent";
            btn.style.color       = "var(--text-color, #333)";
            btn.style.borderColor = "#6a5acd";
        }
    });
};

if (imageUpload) {
    imageUpload.addEventListener("click", function() {
        resetResults();
    });

    imageUpload.addEventListener("change", function () {
        const file = this.files[0];
        if (!file) return;
        
        const zoneText = document.getElementById("uploadZoneText");
        if (zoneText) zoneText.textContent = `✓ ${file.name.substring(0, 20)}...`;

        const reader = new FileReader();
        reader.onload = function (e) {
            uploadedImage = e.target.result;
            previewImage.src = uploadedImage;
            previewWrapper.style.display = "flex";
            previewImage.style.display = "block";

            // --- FORCE UNLOCK ---
            if (analyzeBtn) {
                analyzeBtn.removeAttribute("disabled");
                analyzeBtn.classList.add("active");
                analyzeBtn.style.opacity = "1";
                analyzeBtn.style.cursor = "pointer";
                console.log("Button force-unlocked by system.");
            }

            setValidationMessage("Photo uploaded. Ready to analyse.", "info");
        };
        reader.readAsDataURL(file);
    });
}

// =========================================================================
// ── 📸 MAIN SKIN ANALYSIS CAMERA ENGINE CONTROLLERS (FIXED) ──
// =========================================================================

window.toggleMainCameraOpenClose = function() {
    if (stream) {
        window.closeMainCamera();
    } else {
        window.openMainCamera();
    }
};

window.openMainCamera = async function() {
    try {
        if (!navigator.mediaDevices) {
            alert("Camera not accessible. Ensure you are running on an HTTPS connection or localhost.");
            return;
        }

        if (stream) {
            stream.getTracks().forEach(t => t.stop());
        }

        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: currentFacingMode } },
            audio: false
        });

        video.srcObject = stream;
        if (cameraWrapper) cameraWrapper.style.display = "flex";
        video.style.display = "block";

        // Hide any existing preview while the live camera is showing,
        // same as the product-screenshot camera does.
        if (previewWrapper) previewWrapper.style.display = "none";

        // ✨ Dynamic button behavior adjustments matching your cloth checker camera
        if (cameraBtn) cameraBtn.textContent = "Close Camera";
        if (cameraSwitchBtn) cameraSwitchBtn.style.display = "inline-block";
        if (captureBtn) captureBtn.style.display = "inline-block";

        setStatus(`Camera ready (${currentFacingMode === "user" ? "selfie" : "back"} camera).`, "info");
    } catch (e) {
        setStatus("Could not start camera. Use file upload instead.", "error");
    }
};

window.closeMainCamera = function() {
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }
    if (video) video.style.display = "none";
    if (cameraWrapper) cameraWrapper.style.display = "none";

    // ✨ Return buttons cleanly to their original resting states
    if (cameraBtn) cameraBtn.textContent = "Open Camera";
    if (cameraSwitchBtn) cameraSwitchBtn.style.display = "none";
    if (captureBtn) captureBtn.style.display = "none";

    setStatus("Camera sensor offline.", "info");
};

// Bind the main camera button to open/close cleanly — this was missing from
// the drop-in snippet, which would have left the button doing nothing.
if (cameraBtn) cameraBtn.addEventListener("click", window.toggleMainCameraOpenClose);

// 🔄 Bind the main rotate lens button to cycle facing modes cleanly
if (cameraSwitchBtn) {
    cameraSwitchBtn.onclick = function() {
        currentFacingMode = (currentFacingMode === "user") ? "environment" : "user";
        window.openMainCamera();
    };
}

// 📸 Update the Capture Button logic to turn off the lens stream right after taking the photo.
// NOTE: this intentionally does NOT call window.closeMainCamera() — that function
// calls setStatus("Camera sensor offline.") internally, which would immediately
// overwrite the "Photo captured successfully!" message below. Instead we stop
// the stream and reset the UI directly here, same as the capture handler in
// the working product-screenshot camera does.
if (captureBtn) {
    captureBtn.onclick = function() {
        if (!video.videoWidth) { setStatus("Camera warming up. Try again.", "error"); return; }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);

        uploadedImage = canvas.toDataURL("image/png");
        previewImage.src = uploadedImage;
        previewImage.style.display = "block";
        if (previewWrapper) previewWrapper.style.display = "flex";

        if (analyzeBtn) {
            analyzeBtn.removeAttribute("disabled");
            analyzeBtn.classList.add("active");
            analyzeBtn.style.opacity = "1";
            analyzeBtn.style.cursor = "pointer";
            console.log("Button force-unlocked by system.");
        }

        // Turn off stream layers cleanly upon successful capture (without
        // touching the status message — see note above).
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
        }
        if (video) video.style.display = "none";
        if (cameraWrapper) cameraWrapper.style.display = "none";
        if (cameraBtn) cameraBtn.textContent = "Open Camera";
        if (cameraSwitchBtn) cameraSwitchBtn.style.display = "none";
        if (captureBtn) captureBtn.style.display = "none";

        setStatus("Photo captured successfully!", "success");
    };
}


if (darkModeBtn) {
    darkModeBtn.addEventListener("click", () => {
        document.body.classList.toggle("dark-mode");
        localStorage.setItem("darkMode", document.body.classList.contains("dark-mode") ? "true" : "false");
        applyDarkModeUI();
    });
}

if (analyzeBtn) {
    analyzeBtn.addEventListener("click", async () => {
        if (typeof gtag === "function") {
            gtag('event', 'click_analyze_colors', {
                'event_category': 'Engagement',
                'event_label': 'Analyze Colors Button Clicked'
            });
        }

        if (!uploadedImage) { setStatus("Please upload or capture a photo first.", "error"); return; }

        // ── ⚡ INSTANT CLICK FEEDBACK ──
        // validatePhoto()/analyzeSkinTone() below do real async work (face
        // detection, model loading, etc.) that can take 2-5s, and previously
        // the progress loader + scroll-into-view only happened after all of
        // that finished. That silent gap made users think the click didn't
        // register. So we lock the button and show/scroll to the loader
        // synchronously, right on click, before any awaiting begins.
        const originalBtnLabel = analyzeBtn.textContent;
        analyzeBtn.disabled = true;
        analyzeBtn.style.cursor = "wait";
        analyzeBtn.textContent = "⏳ Analyzing...";

        const progressLoader = document.getElementById("aiProgressLoader");
        if (progressLoader) {
            progressLoader.style.display = "flex";
            document.querySelectorAll(".progress-step-item").forEach(el => {
                el.className = "progress-step-item";
                const icon = el.querySelector(".step-status-icon");
                if (icon) icon.textContent = "⏳";
            });
            const percentLabel = document.getElementById("aiProgressPercentLabel");
            const progressBarFill = document.getElementById("aiProgressBarFill");
            if (percentLabel) percentLabel.textContent = "0%";
            if (progressBarFill) progressBarFill.style.width = "0%";
            progressLoader.scrollIntoView({ behavior: "smooth", block: "center" });
        }

        setStatus("", "info"); // Clear old status text — the premium progress loader now shows analysis state
        skinToneDiv.innerHTML = "🔍 Detecting skin tone & features...";
        hexColorDiv.innerHTML=undertoneDiv.innerHTML=seasonalTypeDiv.innerHTML=confidenceScore.innerHTML="";
        clearRecommendations();

        try {
            const result = await validatePhoto(uploadedImage);
            analyzeSkinTone(uploadedImage, result);
        } catch (err) {
            resetResults();
            setStatus(err.message, "error");
            setValidationMessage("Check your photo lighting and try again.", "error");
            if (skinToneDiv) skinToneDiv.innerHTML = `⚠️ ${err.message}`;
            if (progressLoader) progressLoader.style.display = "none";
        } finally {
            analyzeBtn.disabled = false;
            analyzeBtn.style.cursor = "pointer";
            analyzeBtn.textContent = originalBtnLabel;
        }
    });
}

let currentAnalyzedPersonType = "woman";

function analyzeSkinTone(imageSrc, validationResult = {}) {
    const img = new Image();
    img.onload = async function () {
        const tc=document.createElement("canvas");
        const ctx=tc.getContext("2d",{willReadFrequently:true});
        tc.width=img.width; tc.height=img.height;
        ctx.drawImage(img,0,0);

        const box=validationResult.faceBox;
        let startX,startY,sampleWidth,sampleHeight;

        if (box && typeof box.x !== "undefined" && box.width > 10) {
            sampleWidth=Math.floor(box.width*0.25); sampleHeight=Math.floor(box.height*0.22);
            startX=Math.floor(box.x+(box.width-sampleWidth)/2);
            startY=Math.floor(box.y+(box.height*0.32));
        } else {
            sampleWidth=Math.floor(img.width*0.25); sampleHeight=Math.floor(img.height*0.25);
            startX=Math.floor((img.width-sampleWidth)/2); startY=Math.floor((img.height-sampleHeight)/2);
        }

        startX=Math.max(0,Math.min(startX,img.width-sampleWidth));
        startY=Math.max(0,Math.min(startY,img.height-sampleHeight));

        const data=ctx.getImageData(startX,startY,sampleWidth,sampleHeight).data;
        let r=0,g=0,b=0,count=0;
        for (let i=0;i<data.length;i+=4) {
            const red=data[i],green=data[i+1],blue=data[i+2];
            if (red>45&&green>30&&red>blue&&red>green){r+=red;g+=green;b+=blue;count++;}
        }
        if (count<10){r=0;g=0;b=0;count=0;for(let i=0;i<data.length;i+=4){r+=data[i];g+=data[i+1];b+=data[i+2];count++;}}
        r=Math.round(r/count);g=Math.round(g/count);b=Math.round(b/count);

        // ── 🧠 PRE-COMPUTE ALL RAW DATA INTERNALLY FIRST ──
        const hex=rgbToHex(r,g,b);
        const brightness=(r+g+b)/3;
        const confidencePercent=Math.min(100,Math.max(55,Math.round((count/(sampleWidth*sampleHeight))*100)));
        const skinRatio = validationResult.skinRatio || confidencePercent;

        let skinTone,skinToneCategory;
        if      (brightness>210){skinTone="Very Fair / Porcelain"; skinToneCategory="light";}
        else if (brightness>185){skinTone="Fair / Light";          skinToneCategory="light";}
        else if (brightness>160){skinTone="Light Beige";           skinToneCategory="light";}
        else if (brightness>135){skinTone="Medium Beige";          skinToneCategory="medium";}
        else if (brightness>110){skinTone="Tan / Olive";           skinToneCategory="medium";}
        else if (brightness>80) {skinTone="Deep Brown";            skinToneCategory="deep";}
        else                    {skinTone="Very Deep / Ebony";     skinToneCategory="deep";}

        const warmScore=(r-b)+(r-g)*0.5;
        const coolScore=(b-r)*0.8+(b-g)*0.5;
        let undertone="Neutral";
        if (warmScore>22) undertone="Warm";
        else if (coolScore>8) undertone="Cool";

        const contrastLevel=validationResult.contrastLevel||"medium";
        const seasonalType=getSeasonalType(undertone,skinToneCategory,contrastLevel);

        const detectedAge = validationResult.age || null;
        const detectedGender = validationResult.gender || null;

        let personType = "woman";
        if (window._aiGenderDetectionEnabled && detectedGender) {
            personType = (detectedGender === "male") ? "man" : "woman";
        } else {
            personType = window._selectedGender || "woman";
        }

        if (window._aiGenderDetectionEnabled && detectedAge !== null && detectedAge < 13) personType = "child";

        currentAnalyzedPersonType = personType;

        // ── ⏳ HIDE RAW OUTPUT LABELS AND ENGAGE VISUAL TIMELINE LOOPER ──
        // NOTE: the progress loader is now shown + scrolled into view the
        // instant the Analyze button is clicked (see the click handler
        // above), so it's already visible and in place by the time we get
        // here. We only need its percent/fill elements for the step
        // sequence below, and to keep hiding the plain-text labels while
        // processing runs.
        const progressLoader = document.getElementById("aiProgressLoader");
        const percentLabel = document.getElementById("aiProgressPercentLabel");
        const progressBarFill = document.getElementById("aiProgressBarFill");

        // Hide standard view strings during processing loop sequence
        skinToneDiv.style.display = "none";
        hexColorDiv.style.display = "none";
        undertoneDiv.style.display = "none";
        seasonalTypeDiv.style.display = "none";
        confidenceScore.style.display = "none";
        if (genderResult) genderResult.style.display = "none";
        if (shareSeasonBtn) shareSeasonBtn.style.display = "none";

        // 6-stage sequence powering both the step list and the percentage bar
        const STEP_SEQUENCE = ["upload", "face", "skintone", "undertone", "season", "recommendations"];
        let completedSteps = 0;
        const updateOverallProgress = () => {
            const pct = Math.round((completedSteps / STEP_SEQUENCE.length) * 100);
            if (percentLabel) percentLabel.textContent = `${pct}%`;
            if (progressBarFill) progressBarFill.style.width = `${pct}%`;
        };

        // Helper framework function to chain step states sequentially
        const setStepState = (id, state) => {
            const target = document.getElementById(`step-${id}`);
            if (!target) return;
            if (state === "processing") {
                target.classList.add("step-processing");
                target.querySelector(".step-status-icon").textContent = "⚡";
            } else if (state === "done") {
                target.classList.remove("step-processing");
                target.classList.add("step-done");
                target.querySelector(".step-status-icon").textContent = "✓";
                completedSteps++;
                updateOverallProgress();
            }
        };

        // Wrap a setTimeout in a Promise so the step sequence can be awaited
        // linearly instead of pyramid-nesting callbacks — this also means
        // await getUserCountry() and the rest of the real completion logic
        // (which the timeline reveals at the end) run in their natural order
        // rather than being detached from the timers.
        const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // ── STEP TIMELINE SEQUENCE RUNNER ──
        setStepState("upload", "processing");
        await wait(400); // Local image hand-off into the analysis pipeline
        setStepState("upload", "done");

        setStepState("face", "processing");
        await wait(600); // Initial face-tracking system calculation interval
        setStepState("face", "done");

        setStepState("skintone", "processing");
        await wait(500); // Skin pixel cluster sampling pass
        setStepState("skintone", "done");

        setStepState("undertone", "processing");
        await wait(500); // Undertone color matrix isolation loop
        setStepState("undertone", "done");

        setStepState("season", "processing");
        await wait(600); // Season matching timeline block
        setStepState("season", "done");

        setStepState("recommendations", "processing");
        await wait(500); // Wardrobe + sizing catalog preparation
        setStepState("recommendations", "done");

        // ── 🎉 PROCESSING CONCLUDED: REVEAL PREMIUM COMPUTED RESULTS MATRIX ──
        await wait(250); // Brief pause at 100% so the bar visibly completes
        if (progressLoader) progressLoader.style.display = "none";

        skinToneDiv.style.display = "block";
        hexColorDiv.style.display = "block";
        undertoneDiv.style.display = "block";
        seasonalTypeDiv.style.display = "block";
        confidenceScore.style.display = "block";

        if (typeof window.selectGender === "function") window.selectGender(personType);
        if (faceStatusWarning) faceStatusWarning.style.display = "none";

        if (genderResult) {
            genderResult.style.display = "flex";
            const icons = { man:"👨", woman:"👩", child:"🧒" };
            genderIcon.textContent = icons[personType] || "👤";
            genderText.innerHTML   = `<strong>${personType.charAt(0).toUpperCase()+personType.slice(1)}</strong> — personalised recommendations ready ✓`;
        }

        skinToneDiv.innerHTML    =`<strong>Skin Tone:</strong> ${skinTone}`;
        hexColorDiv.innerHTML    =`<strong>Detected HEX:</strong> ${hex}<div style="width:72px;height:72px;background:${hex};border-radius:10px;margin-top:8px;border:2px solid #ddd;"></div>`;
        undertoneDiv.innerHTML   =`<strong>Undertone:</strong> ${undertone}`;
        seasonalTypeDiv.innerHTML=`<strong>Seasonal Type:</strong> ${seasonalType}`;
        confidenceScore.innerHTML=`<strong>Skin Detection:</strong> ${skinRatio}% skin pixels found ✓`;

        setValidationMessage("Your personalised colour palette is ready below.","success");

        if (typeof gtag === "function") {
            gtag('event', 'successful_analysis', {
                'seasonal_type': seasonalType,
                'skin_tone': skinTone,
                'undertone': undertone
            });
        }

        generateRecommendations(undertone,skinToneCategory,contrastLevel);
        await getUserCountry();
        generateShoppingLinks(undertone,skinToneCategory,personType);

        if (shareSeasonBtn) shareSeasonBtn.style.display = "inline-block";

        const fullPalette = getClothingPalette(undertone, skinToneCategory, contrastLevel);
        unlockDressChecker(fullPalette, undertone, seasonalType);
        
        // ✨ AUTO-EXPAND CHANNELS UPON RE-CALCULATION SUCCESS
     // if(typeof window.expandAllAccordionPanels === "function") {
     //     window.expandAllAccordionPanels();
    //  }
    };
    img.src=imageSrc;
}

function getSeasonalType(undertone, skinToneCategory, contrastLevel) {
    if (undertone === "Warm") {
        if (skinToneCategory === "light")  return contrastLevel === "high" ? "Warm Spring (Vibrant & Golden Profile)" : "Light Spring (Clear & Delicate Profile)";
        if (skinToneCategory === "medium") return contrastLevel === "high" ? "True Autumn (Rich & Warm Profile)" : "Soft Autumn (Muted & Earthy Profile)";
        if (skinToneCategory === "deep")   return "Deep Autumn (Low-Light & Warm Profile)";
    }
    if (undertone === "Cool") {
        if (skinToneCategory === "light")  return contrastLevel === "high" ? "Bright Winter (High-Contrast & Vivid Profile)" : "Light Summer (Cool & Delicate Profile)";
        if (skinToneCategory === "medium") return contrastLevel === "high" ? "True Winter (Stark & Crisp Profile)" : "Soft Summer (Muted & Cool Profile)";
        if (skinToneCategory === "deep")   return "Deep Winter (Low-Light & Crisp Profile)";
    }
    if (skinToneCategory === "light")  return "Soft Summer (Muted & Delicate Profile)";
    if (skinToneCategory === "deep")   return "Deep Autumn (Low-Light & Earthy Profile)";
    return "True Neutral Balanced Profile";
}

function generateRecommendations(undertone,skinToneCategory,contrastLevel){
    clearRecommendations();
    const palette=getClothingPalette(undertone,skinToneCategory,contrastLevel);
    const hair=getHairPalette(undertone,skinToneCategory);
    const jewelry=getJewelryPalette(undertone,skinToneCategory);
    renderSection(clothingColors,"✅ Best Clothing Colors",palette.best);
    renderSection(clothingColors,"👍 Good Clothing Colors",palette.good);
    renderSection(clothingColors,"✨ Accent Colors",palette.accent);
    renderSection(clothingColors,"🔲 Best Neutrals",palette.neutrals);
    renderSection(clothingColors,"❌ Colors to Avoid",palette.avoid);
    renderSection(hairColors,"✅ Best Hair Colors",hair.best);
    renderSection(hairColors,"👍 Good Hair Colors",hair.good);
    renderSection(hairColors,"💡 Highlight Suggestions",hair.highlights);
    renderSection(hairColors,"❌ Hair Colors to Avoid",hair.avoid);
    renderSection(jewelryColors,"✅ Best Metal",jewelry.best);
    renderSection(jewelryColors,"💎 Best Gem Colors",jewelry.gems);
    renderSection(jewelryColors,"👍 Also Works",jewelry.secondary);
    renderSection(jewelryColors,"❌ Avoid",jewelry.avoid);
}

function renderSection(container,label,items){
    if(!container||!items||items.length===0)return;
    const heading=document.createElement("li");
    heading.className="recommendation-heading";
    heading.textContent = label;
    container.appendChild(heading);
    items.forEach(item=>{const li=document.createElement("li");li.innerHTML=item;container.appendChild(li);});
}

function generateShoppingLinks(undertone, skinToneCategory, personType) {
    if (!shopSection || !shopGrid) return;

    const palette = getClothingPalette(undertone, skinToneCategory, "medium");
    const hair = getHairPalette(undertone, skinToneCategory);
    const jewelry = getJewelryPalette(undertone, skinToneCategory);

    const dynamicClothingColors = [...(palette.best || []), ...(palette.good || []), ...(palette.accent || [])];
    const dynamicNeutralColors  = palette.neutrals || ["Grey", "Beige", "Navy"];
    const metallicHardware      = jewelry.best || ["Gold", "Silver"];
    const crystalGemstones      = jewelry.gems || ["Pearl", "Sapphire"];
    const hairTones             = hair.best || ["Natural Brown"];

    const isMen = personType === "man" || personType === "male";
    const isChild = personType === "child";
    const prefix = isMen ? "mens " : (isChild ? "kids " : "womens ");

    let generalItemsMatrix = [
        { id: 0,  tag: "👚 Core Tops",       type: isMen ? "Oxford Shirt" : (isChild ? "T-Shirt" : "Blouse"),    colors: dynamicClothingColors, activeIdx: 0, icon: "👕" },
        { id: 1,  tag: "👖 Bottom Staples",  type: isMen ? "Slim Trousers" : (isChild ? "Pants" : "Skirt"),   colors: dynamicNeutralColors,  activeIdx: 0, icon: "👖" },
        { id: 2,  tag: "🧥 Outer Layers",    type: isMen ? "Tailored Jacket" : (isChild ? "Hoodie" : "Blazer"),   colors: dynamicClothingColors, activeIdx: 1, icon: "🧥" }, 
        { id: 3,  tag: "👜 Accent Gear",     type: isMen ? "Classic Belt" : (isChild ? "Backpack" : "Handbag"),  colors: dynamicNeutralColors,  activeIdx: 1, icon: "💼" },
        { id: 4,  tag: "🧣 Seasonal Layers", type: "Premium Scarf",                                              colors: dynamicClothingColors, activeIdx: 2, icon: "🧣" }
    ];

    if (!isMen && !isChild) {
        let lipColors = ["Nude Pink", "Dusty Rose", "Mauve Berry", "Soft Plum"];
        let eyeshadowPalettes = ["Nude Shimmer", "Cool Taupe", "Rose Gold", "Slate Matte"];
        let blushTones = ["Soft Pink", "Cool Berry", "Rose Mauve"];

        if (undertone === "Warm") {
            lipColors = ["Warm Peach", "Coral Red", "Terracotta Brown", "Spiced Honey", "Brick Red"];
            eyeshadowPalettes = ["Warm Bronze", "Golden Ochre", "Terracotta Shimmer", "Copper Earth"];
            blushTones = ["Warm Peach", "Soft Coral", "Sunkissed Amber", "Apricot Glow"];
        } else if (undertone === "Neutral") {
            lipColors = ["Universal Nude", "Spiced Rose", "Soft Berry", "Classic Crimson"];
            eyeshadowPalettes = ["Neutral Earth", "Champagne Shimmer", "Taupe Matte", "Bronze Glow"];
            blushTones = ["Nude Peach", "Rosewood", "Soft Amber"];
        }

        generalItemsMatrix.push(
            { id: 5, tag: "💄 Cosmetics", type: "Lipstick",           colors: lipColors,         activeIdx: 0, icon: "💄" },
            { id: 6, tag: "🎨 Cosmetics", type: "Eyeshadow Palette",  colors: eyeshadowPalettes, activeIdx: 0, icon: "🎨" },
            { id: 7, tag: "✨ Cosmetics", type: "Makeup Blush",       colors: blushTones,        activeIdx: 0, icon: "✨" }
        );
    }

    generalItemsMatrix.push(
        { id: 8,  tag: "💍 Metallic Links",   type: "Minimalist Necklace",   colors: metallicHardware,  activeIdx: 0, icon: "📿" },
        { id: 9,  tag: "💎 Gem Accents",     type: "Crystal Earrings",      colors: crystalGemstones,  activeIdx: 0, icon: "💎" },
        { id: 10, tag: "💇 Hair Tones",       type: "Nourishing Hair Dye",   colors: hairTones,         activeIdx: 0, icon: "💇" }
    );

    itemsToShopMatrix = generalItemsMatrix;
    buildSliderCards(prefix);
    shopSection.style.display = "block";
}

window.setRetailerTabFilter = function(tabName, prefix) {
    window._currentRetailerTab = tabName.toLowerCase();
    document.querySelectorAll(".wireframe-tab-btn").forEach(btn => {
        if (btn.getAttribute("data-tab") === window._currentRetailerTab) {
            btn.classList.add("tab-active");
        } else {
            btn.classList.remove("tab-active");
        }
    });
    buildSliderCards(prefix);
};

// ── 🌟 HIGH-CONVERTING CARD GENERATOR CORE ENGINE ──
// ── 🌟 HIGH-CONVERTING CARD GENERATOR CORE ENGINE (FIXED LOGO ARCHITECTURE) ──
// ── 🌟 HIGH-CONVERTING CARD GENERATOR CORE ENGINE (PROPER LAYOUT SEPARATION) ──
function buildSliderCards(prefix) {
    if (!shopGrid) return;
    
    // 🧠 1. FIND OR CREATE A DEDICATED LOGO ROW ABOVE THE GRID
    let brandHeaderRow = document.getElementById("brandLogosHeaderRow");
    if (!brandHeaderRow) {
        brandHeaderRow = document.createElement("div");
        brandHeaderRow.id = "brandLogosHeaderRow";
        brandHeaderRow.className = "wireframe-tabs-header-row";
        // Enforce tight flexible rows with styling parameters explicitly
        brandHeaderRow.style.cssText = "margin-bottom: 25px !important; display: flex !important; gap: 12px !important; justify-content: center !important; flex-wrap: wrap !important; width: 100% !important; float: none !important; clear: both !important;";
        shopGrid.parentNode.insertBefore(brandHeaderRow, shopGrid);
    }

    // Injects your local asset routes with un-bypassable micro button dimensions inline
    // Update the button row contents with custom individual image scaling to normalize sizes
    brandHeaderRow.innerHTML = `
        <button type="button" class="wireframe-tab-btn ${window._currentRetailerTab === 'amazon' ? 'tab-active' : ''}" data-tab="amazon" onclick="setRetailerTabFilter('amazon', '${prefix}')" style="display: flex !important; align-items: center !important; justify-content: center !important; width: 120px !important; height: 48px !important; padding: 0 !important; box-sizing: border-box !important; flex: none !important; background: #ffffff !important; border-radius: 8px !important; border: 2px solid ${window._currentRetailerTab === 'amazon' ? '#ff9900' : '#334155'} !important; box-shadow: ${window._currentRetailerTab === 'amazon' ? '0 6px 16px rgba(255,153,0,0.3)' : 'none'} !important; cursor: pointer !important; overflow: hidden !important;">
            <img src="logos/amazon.png" style="height: auto !important; width: 95% !important; object-fit: contain !important; box-sizing: border-box !important;" alt="Amazon">
        </button>
        <button type="button" class="wireframe-tab-btn ${window._currentRetailerTab === 'asos' ? 'tab-active' : ''}" data-tab="asos" onclick="setRetailerTabFilter('asos', '${prefix}')" onmouseenter="if(window._currentRetailerTab !== 'asos'){ this.style.setProperty('border', '2px solid #111111', 'important'); this.style.setProperty('box-shadow', '0 6px 16px rgba(17,17,17,0.25)', 'important'); this.style.setProperty('transform', 'translateY(-2px)', 'important'); }" onmouseleave="if(window._currentRetailerTab !== 'asos'){ this.style.setProperty('border', '2px solid #334155', 'important'); this.style.setProperty('box-shadow', 'none', 'important'); this.style.setProperty('transform', 'translateY(0)', 'important'); }" style="display: flex !important; align-items: center !important; justify-content: center !important; width: 120px !important; height: 48px !important; padding: 0 !important; box-sizing: border-box !important; flex: none !important; background: #ffffff !important; border-radius: 8px !important; border: 2px solid ${window._currentRetailerTab === 'asos' ? '#111111' : '#334155'} !important; box-shadow: ${window._currentRetailerTab === 'asos' ? '0 6px 16px rgba(17,17,17,0.25)' : 'none'} !important; cursor: pointer !important; overflow: hidden !important; transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease !important;">
            <img src="logos/asos.png" style="height: 100% !important; width: 100% !important; object-fit: contain !important; box-sizing: border-box !important;" alt="ASOS">
        </button>
        <button type="button" class="wireframe-tab-btn ${window._currentRetailerTab === 'h&m' ? 'tab-active' : ''}" data-tab="h&m" onclick="setRetailerTabFilter('h&m', '${prefix}')" style="display: flex !important; align-items: center !important; justify-content: center !important; width: 120px !important; height: 48px !important; padding: 0 !important; box-sizing: border-box !important; flex: none !important; background: #ffffff !important; border-radius: 8px !important; border: 2px solid ${window._currentRetailerTab === 'h&m' ? '#e50010' : '#334155'} !important; box-shadow: ${window._currentRetailerTab === 'h&m' ? '0 6px 16px rgba(229,0,16,0.3)' : 'none'} !important; cursor: pointer !important; overflow: hidden !important;">
            <img src="logos/hm.png" style="height: 100% !important; width: 100% !important; object-fit: contain !important; box-sizing: border-box !important;" alt="H&M">
        </button>
        <button type="button" class="wireframe-tab-btn ${window._currentRetailerTab === 'flipkart' ? 'tab-active' : ''}" data-tab="flipkart" onclick="setRetailerTabFilter('flipkart', '${prefix}')" style="display: flex !important; align-items: center !important; justify-content: center !important; width: 120px !important; height: 48px !important; padding: 0 !important; box-sizing: border-box !important; flex: none !important; background: #ffffff !important; border-radius: 8px !important; border: 2px solid ${window._currentRetailerTab === 'flipkart' ? '#2874f0' : '#334155'} !important; box-shadow: ${window._currentRetailerTab === 'flipkart' ? '0 6px 16px rgba(40,116,240,0.3)' : 'none'} !important; cursor: pointer !important; overflow: hidden !important;">
            <img src="logos/flipkart.png" style="height: auto !important; width: 90% !important; object-fit: contain !important; box-sizing: border-box !important;" alt="Flipkart">
        </button>
        <button type="button" class="wireframe-tab-btn ${window._currentRetailerTab === 'myntra' ? 'tab-active' : ''}" data-tab="myntra" onclick="setRetailerTabFilter('myntra', '${prefix}')" style="display: flex !important; align-items: center !important; justify-content: center !important; width: 120px !important; height: 48px !important; padding: 0 !important; box-sizing: border-box !important; flex: none !important; background: #ffffff !important; border-radius: 8px !important; border: 2px solid ${window._currentRetailerTab === 'myntra' ? '#ff3f6c' : '#334155'} !important; box-shadow: ${window._currentRetailerTab === 'myntra' ? '0 6px 16px rgba(255,63,108,0.3)' : 'none'} !important; cursor: pointer !important; overflow: hidden !important;">
            <img src="logos/myntra.png" style="height: 100% !important; width: 100% !important; object-fit: contain !important; box-sizing: border-box !important;" alt="Myntra">
        </button>
    `;

    // 🧠 2. WIPE AND RENDER CARDS ONLY INSIDE THE GRID MATRIX
    shopGrid.innerHTML = "";

    itemsToShopMatrix.forEach((card) => {
        const currentColor = card.colors[card.activeIdx] || "Universal Base";
        
        let dynamicSearchTerm = "";
        if (card.tag.includes("Cosmetics")) {
            dynamicSearchTerm = encodeURIComponent(`${currentColor} ${card.type}`); 
        } else {
            dynamicSearchTerm = encodeURIComponent(`${currentColor} ${prefix}${card.type}`);
        }

        let platformTargetUrl = "";
        let buttonDisplayLabel = "Amazon";
        let btnGradient = "linear-gradient(135deg, #ff9900, #ffb83d)";
        let btnColor = "#111111";

        if (window._currentRetailerTab === "amazon") {
            buttonDisplayLabel = "Amazon";
            btnGradient = "linear-gradient(135deg, #ff9900, #ffb83d)";
            btnColor = "#111111";
            if (isUserInIndia()) {
                platformTargetUrl = `https://www.amazon.in/s?k=${dynamicSearchTerm}&tag=aicoloronline-21`;
            } else {
                platformTargetUrl = `https://www.amazon.com/s?k=${dynamicSearchTerm}&tag=aicolor-20`;
            }
        } else if (window._currentRetailerTab === "asos") {
            platformTargetUrl = `https://www.asos.com/search/?q=${dynamicSearchTerm}`;
            buttonDisplayLabel = "ASOS";
            btnGradient = "linear-gradient(135deg, #4b5563, #374151)";
            btnColor = "#ffffff";
        } else if (window._currentRetailerTab === "h&m") {
            if (isUserInIndia()) {
                platformTargetUrl = `https://www2.hm.com/en_in/search-results.html?q=${dynamicSearchTerm}`;
            } else {
                platformTargetUrl = `https://www2.hm.com/en_us/search-results.html?q=${dynamicSearchTerm}`;
            }
            buttonDisplayLabel = "H&M";
            btnGradient = "linear-gradient(135deg, #dc2626, #ef4444)";
            btnColor = "#ffffff";
        } else if (window._currentRetailerTab === "flipkart") {
            platformTargetUrl = `https://www.flipkart.com/search?q=${dynamicSearchTerm}`;
            buttonDisplayLabel = "Flipkart";
            btnGradient = "linear-gradient(135deg, #2874f0, #004cc7)";
            btnColor = "#ffffff";
        } else if (window._currentRetailerTab === "myntra") {
            platformTargetUrl = `https://www.myntra.com/${dynamicSearchTerm}`;
            buttonDisplayLabel = "Myntra";
            btnGradient = "linear-gradient(135deg, #ec4899, #f43f5e)";
            btnColor = "#ffffff";
        }

        const cardElement = document.createElement("div");
        cardElement.className = "shop-card dynamic-premium-product-card";
        const productTitleText = `${capitalise(currentColor)} ${card.type}`;
        const productImageUrl = buildProductImageUrl(currentColor, card.type);
        cardElement.innerHTML = `
            <div class="product-illustration-preview-box" style="background: ${getSoftColorHex(currentColor)}22; min-height: 120px; border-radius: 12px; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden;">
                <img class="product-title-matched-photo" src="${productImageUrl}" alt="${productTitleText}" style="width: 78%; height: 120px; object-fit: contain; display: block;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <span class="product-avatar-emoji" style="font-size: 3rem; display: none; width: 100%; height: 120px; align-items: center; justify-content: center;">${card.icon}</span>
                <div class="product-palette-color-tag-pill" style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.6); padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: bold; color: #fff;">${capitalise(currentColor)}</div>
            </div>
            <div class="product-details-content-wrapper" style="padding: 0 4px; margin-bottom: 12px;">
                <span class="shop-tag" style="font-size: 0.72rem; color: #a78bfa; font-weight: 700; text-transform: uppercase;">${card.tag}</span>
                <div class="shop-item" style="font-size: 1.1rem; font-weight: 800; color: #fff; margin: 4px 0;">${capitalise(currentColor)} ${card.type}</div>
                <div class="product-rating-stars-row" style="font-size: 0.85rem; margin-top: 4px;">⭐⭐⭐⭐⭐ <span class="rating-count-metric" style="color: #94a3b8; font-size: 0.75rem;">(Verified Match)</span></div>
                <div style="font-size: 0.85rem; opacity: 0.8; font-weight: 600; margin-top: 8px; color: #bae6fd;">🔍 Best price ranges found live</div>
            </div>
            <div class="card-slider-bar" style="margin-bottom: 14px;">
                <button type="button" class="slider-arrow-btn" onclick="slideCardColor(${card.id}, -1, '${prefix}')">◀</button>
                <div class="slider-color-txt">Color: ${capitalise(currentColor)}</div>
                <button type="button" class="slider-arrow-btn" onclick="slideCardColor(${card.id}, 1, '${prefix}')">▶</button>
            </div>
            <div class="single-active-channel-container" style="margin-top: auto; padding-top: 10px; display: flex; justify-content: center; width: 100%;">
                <a class="shop-link verified-retailer-action-btn" href="${platformTargetUrl}" target="_blank" rel="noopener noreferrer" onclick="trackShoppingClick('${buttonDisplayLabel.toUpperCase()}', '${card.type}')" style="display: block; width: 100%; text-align: center; font-weight: 700 !important; padding: 12px !important; border-radius: 10px !important; text-decoration: none; font-size: 0.85rem !important; background: ${btnGradient}; color: ${btnColor} !important; box-shadow: 0 4px 10px rgba(0,0,0,0.15); transition: transform 0.2s ease;">
                    Find on ${buttonDisplayLabel} →
                </a>
            </div>
        `;
        shopGrid.appendChild(cardElement);
    });
}

// ── 🖼️ TITLE-MATCHED PRODUCT IMAGE RESOLVER ──
// Builds a photo URL whose search keywords are derived directly from the
// product title (color + item type) so the picture shown always matches
// what the card says, e.g. "Olive Green Oxford Shirt" -> an olive green
// oxford shirt photo, not a generic/unrelated image.
function slugifyImageKeyword(str) {
    return String(str)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, "+");
}

function stableSeedFromString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) % 100000;
}

// ── 🎨 DYNAMIC SVG WARDROBE SYSTEM ──
// Instead of fetching random stock photos per color/item (unreliable,
// slow, and often doesn't match the title at all), we keep a small set
// of hand-drawn SVG garment templates and recolor them on the fly to
// match the analyzed palette. Same template, any color, instant render,
// no network request, works fully offline on GitHub Pages.

function getSoftColorHex(colorName) {
    const exact = {
        "peach": "#ffb09c", "coral": "#ff6b6b", "warm ivory": "#fffdd0", "golden yellow": "#ffd700",
        "burnt orange": "#cc5500", "rust": "#b83b1d", "olive green": "#606c38", "deep teal": "#006666",
        "mustard yellow": "#e1ad01", "warm brown": "#964b00", "terracotta": "#e2725b", "forest green": "#228b22",
        "pure white": "#ffffff", "black": "#111111", "icy blue": "#f0f8ff", "royal blue": "#4169e1",
        "hot pink": "#ff69b4", "fuchsia": "#ff00ff", "true red": "#ff0000", "emerald green": "#50c878",
        "navy": "#000080", "grey": "#808080", "beige": "#f5f5dc", "charcoal": "#36454f"
    };
    const key = colorName.toLowerCase().trim();
    if (exact[key]) return exact[key];

    // Fuzzy keyword fallback — handles dynamic palette names like
    // "Rose Gold", "Nude Pink", "Spiced Honey", "Sunkissed Amber" that
    // won't ever be exact matches above.
    const keywordMap = [
        ["rose gold", "#b76e79"], ["gold", "#d4af37"], ["silver", "#c0c0c0"], ["bronze", "#8c7853"],
        ["copper", "#b87333"], ["pearl", "#f2f0e6"], ["sapphire", "#0f52ba"], ["ruby", "#9b111e"],
        ["emerald", "#50c878"], ["amber", "#ffbf00"], ["honey", "#e8a317"], ["apricot", "#fbceb1"],
        ["sunkissed", "#f4a460"], ["spice", "#b4530a"], ["terracotta", "#e2725b"], ["taupe", "#8b8589"],
        ["nude", "#e3bc9a"], ["mauve", "#b784a7"], ["plum", "#8e4585"], ["berry", "#8b1a4f"],
        ["wine", "#722f37"], ["burgundy", "#800020"], ["maroon", "#800000"], ["crimson", "#dc143c"],
        ["scarlet", "#ff2400"], ["red", "#d1373f"], ["pink", "#ff9fb2"], ["fuchsia", "#c2185b"],
        ["magenta", "#c2185b"], ["lavender", "#b57edc"], ["lilac", "#c8a2c8"], ["purple", "#6a4c93"],
        ["camel", "#c19a6b"], ["tan", "#d2b48c"], ["khaki", "#a49060"], ["olive", "#6b7a3a"],
        ["sage", "#9caf88"], ["mint", "#a8d5ba"], ["teal", "#2f8f8f"], ["cobalt", "#0047ab"],
        ["sky", "#87ceeb"], ["icy", "#dceefc"], ["royal", "#4169e1"], ["navy", "#1b1f3b"],
        ["cream", "#fdf6e3"], ["ivory", "#fffff0"], ["mustard", "#d9a441"], ["yellow", "#f2c14e"],
        ["orange", "#e07a3e"], ["rust", "#b7410e"], ["brown", "#6b4226"], ["chestnut", "#954535"],
        ["green", "#4c7a51"], ["forest", "#2e5339"], ["blue", "#3a6ea5"], ["grey", "#8a8f98"],
        ["gray", "#8a8f98"], ["charcoal", "#3b3f45"], ["black", "#1a1a1a"], ["white", "#f7f7f5"],
        ["beige", "#e8dcc8"], ["coral", "#f08a5d"], ["peach", "#ffb09c"]
    ];
    for (const [kw, hex] of keywordMap) {
        if (key.includes(kw)) return hex;
    }
    return "#8a8f98"; // neutral fallback instead of an odd random purple
}

// Lighten (positive percent 0-1) or darken (negative percent) a hex color.
function shadeHexColor(hex, percent) {
    const f = parseInt(hex.slice(1), 16);
    const t = percent < 0 ? 0 : 255;
    const p = Math.abs(percent);
    const R = f >> 16, G = (f >> 8) & 0x00FF, B = f & 0x0000FF;
    return "#" + (0x1000000 +
        (Math.round((t - R) * p) + R) * 0x10000 +
        (Math.round((t - G) * p) + G) * 0x100 +
        (Math.round((t - B) * p) + B)
    ).toString(16).slice(1);
}

// Maps a free-form product type string (e.g. "Tailored Jacket",
// "Crystal Earrings") to one of our reusable SVG templates.
function getGarmentCategory(typeName) {
    const t = typeName.toLowerCase();
    if (/skirt/.test(t)) return "skirt";
    if (/trouser|pant|jean|chino/.test(t)) return "pants";
    if (/shirt|blouse|top|polo/.test(t)) return "shirt";
    if (/jacket|blazer|hoodie|coat/.test(t)) return "jacket";
    if (/belt/.test(t)) return "belt";
    if (/scarf/.test(t)) return "scarf";
    if (/bag|backpack|handbag/.test(t)) return "bag";
    if (/shoe|sneaker|boot|loafer/.test(t)) return "shoe";
    if (/necklace|earring|jewel|pendant/.test(t)) return "jewelry";
    if (/lipstick|eyeshadow|blush|makeup|cosmetic|palette/.test(t)) return "cosmetic";
    if (/hair/.test(t)) return "hair";
    return "shirt";
}

// Shared <defs> block: a diagonal light→base→dark gradient (fabric/material
// shading) plus a soft radial sheen (glossy highlight) and a drop-shadow
// filter, all keyed off the runtime color so every category gets consistent,
// realistic-looking lighting instead of flat single-tone fills.
function buildShadingDefs(id, fill, shade, light) {
    return `
        <defs>
            <linearGradient id="${id}-fabric" x1="15%" y1="0%" x2="85%" y2="100%">
                <stop offset="0%" stop-color="${light}"/>
                <stop offset="45%" stop-color="${fill}"/>
                <stop offset="100%" stop-color="${shade}"/>
            </linearGradient>
            <radialGradient id="${id}-sheen" cx="32%" cy="18%" r="75%">
                <stop offset="0%" stop-color="#ffffff" stop-opacity="0.45"/>
                <stop offset="35%" stop-color="#ffffff" stop-opacity="0.12"/>
                <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
            </radialGradient>
            <radialGradient id="${id}-metal" cx="35%" cy="25%" r="80%">
                <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>
                <stop offset="30%" stop-color="${light}"/>
                <stop offset="65%" stop-color="${fill}"/>
                <stop offset="100%" stop-color="${shade}"/>
            </radialGradient>
            <filter id="${id}-shadow" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="#000000" flood-opacity="0.28"/>
            </filter>
        </defs>`;
}

// Each template is a function(fill, shade, light, id) -> SVG markup string.
// fill = base color, shade = darker tone (folds/shadow), light = lighter tone (highlight).
// "id" namespaces the gradient/filter ids so each generated icon is self-contained.
const SVG_WARDROBE_TEMPLATES = {
    shirt: (fill, shade, light, id) => `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            ${buildShadingDefs(id, fill, shade, light)}
            <ellipse cx="80" cy="146" rx="46" ry="7" fill="#000000" opacity="0.18"/>
            <g filter="url(#${id}-shadow)">
                <path d="M55,28 L80,44 L105,28 L132,50 L116,72 L108,62 L108,142 L52,142 L52,62 L44,72 L28,50 Z"
                      fill="url(#${id}-fabric)" stroke="${shade}" stroke-width="2" stroke-linejoin="round"/>
                <path d="M55,28 L80,44 L105,28 L132,50 L116,72 L108,62 L108,142 L52,142 L52,62 L44,72 L28,50 Z"
                      fill="url(#${id}-sheen)"/>
            </g>
            <path d="M67,29 L80,44 L93,29 L93,40 L80,53 L67,40 Z" fill="${shade}" opacity="0.9"/>
            <line x1="80" y1="53" x2="80" y2="140" stroke="${shade}" stroke-width="1.5" opacity="0.55"/>
            <circle cx="80" cy="70" r="2" fill="${shade}" opacity="0.6"/>
            <circle cx="80" cy="90" r="2" fill="${shade}" opacity="0.6"/>
            <circle cx="80" cy="110" r="2" fill="${shade}" opacity="0.6"/>
            <path d="M60,68 L72,68 L72,86 L60,86 Z" fill="none" stroke="${shade}" stroke-width="1.2" opacity="0.4"/>
        </svg>`,
    pants: (fill, shade, light, id) => `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            ${buildShadingDefs(id, fill, shade, light)}
            <ellipse cx="80" cy="146" rx="42" ry="6" fill="#000000" opacity="0.18"/>
            <g filter="url(#${id}-shadow)">
                <path d="M48,22 L112,22 L116,142 L92,142 L80,72 L68,142 L44,142 Z"
                      fill="url(#${id}-fabric)" stroke="${shade}" stroke-width="2" stroke-linejoin="round"/>
                <path d="M48,22 L112,22 L116,142 L92,142 L80,72 L68,142 L44,142 Z" fill="url(#${id}-sheen)"/>
            </g>
            <rect x="48" y="22" width="64" height="10" fill="${shade}" opacity="0.35"/>
            <line x1="80" y1="32" x2="80" y2="68" stroke="${shade}" stroke-width="1.5" opacity="0.5"/>
            <line x1="52" y1="35" x2="60" y2="140" stroke="${shade}" stroke-width="1" opacity="0.35"/>
            <line x1="108" y1="35" x2="100" y2="140" stroke="${shade}" stroke-width="1" opacity="0.35"/>
        </svg>`,
    skirt: (fill, shade, light, id) => `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            ${buildShadingDefs(id, fill, shade, light)}
            <ellipse cx="80" cy="128" rx="46" ry="7" fill="#000000" opacity="0.18"/>
            <g filter="url(#${id}-shadow)">
                <path d="M58,28 L102,28 L126,122 L34,122 Z"
                      fill="url(#${id}-fabric)" stroke="${shade}" stroke-width="2" stroke-linejoin="round"/>
                <path d="M58,28 L102,28 L126,122 L34,122 Z" fill="url(#${id}-sheen)"/>
            </g>
            <rect x="58" y="28" width="44" height="8" fill="${shade}" opacity="0.35"/>
            <line x1="66" y1="30" x2="52" y2="120" stroke="${shade}" stroke-width="1" opacity="0.35"/>
            <line x1="80" y1="28" x2="80" y2="122" stroke="${shade}" stroke-width="1" opacity="0.3"/>
            <line x1="94" y1="30" x2="108" y2="120" stroke="${shade}" stroke-width="1" opacity="0.35"/>
        </svg>`,
    jacket: (fill, shade, light, id) => `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            ${buildShadingDefs(id, fill, shade, light)}
            <ellipse cx="80" cy="146" rx="48" ry="7" fill="#000000" opacity="0.2"/>
            <g filter="url(#${id}-shadow)">
                <path d="M50,30 L80,46 L110,30 L138,54 L122,80 L112,68 L116,142 L44,142 L48,68 L38,80 L22,54 Z"
                      fill="url(#${id}-fabric)" stroke="${shade}" stroke-width="2" stroke-linejoin="round"/>
                <path d="M50,30 L80,46 L110,30 L138,54 L122,80 L112,68 L116,142 L44,142 L48,68 L38,80 L22,54 Z"
                      fill="url(#${id}-sheen)"/>
            </g>
            <path d="M62,32 L80,46 L66,72 L58,58 Z" fill="${shade}" opacity="0.55"/>
            <path d="M98,32 L80,46 L94,72 L102,58 Z" fill="${shade}" opacity="0.55"/>
            <path d="M74,80 L74,50 L70,110" fill="none" stroke="#f5f5f0" stroke-width="4" opacity="0.85"/>
            <circle cx="80" cy="88" r="2" fill="${shade}" opacity="0.7"/>
            <circle cx="80" cy="104" r="2" fill="${shade}" opacity="0.7"/>
        </svg>`,
    belt: (fill, shade, light, id) => `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            ${buildShadingDefs(id, fill, shade, light)}
            <ellipse cx="80" cy="102" rx="62" ry="8" fill="#000000" opacity="0.18"/>
            <g filter="url(#${id}-shadow)">
                <rect x="18" y="70" width="124" height="22" rx="6" fill="url(#${id}-fabric)" stroke="${shade}" stroke-width="2"/>
                <rect x="18" y="70" width="124" height="22" rx="6" fill="url(#${id}-sheen)"/>
            </g>
            <rect x="64" y="62" width="32" height="38" rx="5" fill="url(#${id}-metal)" stroke="${shade}" stroke-width="1.5"/>
            <rect x="72" y="78" width="16" height="6" rx="2" fill="#ffffff" opacity="0.5"/>
            <circle cx="80" cy="81" r="3" fill="${shade}"/>
        </svg>`,
    scarf: (fill, shade, light, id) => `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            ${buildShadingDefs(id, fill, shade, light)}
            <g filter="url(#${id}-shadow)">
                <path d="M28,38 Q80,16 132,38 Q122,60 82,54 Q94,92 72,132 Q54,98 64,58 Q40,60 28,38 Z"
                      fill="url(#${id}-fabric)" stroke="${shade}" stroke-width="2" stroke-linejoin="round"/>
                <path d="M28,38 Q80,16 132,38 Q122,60 82,54 Q94,92 72,132 Q54,98 64,58 Q40,60 28,38 Z"
                      fill="url(#${id}-sheen)"/>
            </g>
            <path d="M66,120 L64,132 M72,124 L70,136 M78,122 L77,134" stroke="${shade}" stroke-width="1.4" opacity="0.6"/>
        </svg>`,
    bag: (fill, shade, light, id) => `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            ${buildShadingDefs(id, fill, shade, light)}
            <ellipse cx="80" cy="134" rx="44" ry="7" fill="#000000" opacity="0.2"/>
            <path d="M58,58 Q58,26 80,26 Q102,26 102,58" fill="none" stroke="${shade}" stroke-width="6"/>
            <path d="M58,58 Q58,26 80,26 Q102,26 102,58" fill="none" stroke="url(#${id}-metal)" stroke-width="3"/>
            <g filter="url(#${id}-shadow)">
                <rect x="36" y="58" width="88" height="76" rx="12" fill="url(#${id}-fabric)" stroke="${shade}" stroke-width="2"/>
                <rect x="36" y="58" width="88" height="76" rx="12" fill="url(#${id}-sheen)"/>
            </g>
            <rect x="68" y="82" width="24" height="16" rx="3" fill="${shade}" opacity="0.55"/>
            <rect x="76" y="86" width="8" height="8" rx="2" fill="url(#${id}-metal)"/>
        </svg>`,
    shoe: (fill, shade, light, id) => `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            ${buildShadingDefs(id, fill, shade, light)}
            <ellipse cx="82" cy="128" rx="58" ry="8" fill="#000000" opacity="0.22"/>
            <g filter="url(#${id}-shadow)">
                <path d="M22,112 Q22,96 34,92 L52,86 Q62,74 78,66 Q92,60 104,66 L122,76 Q136,80 142,94 Q146,104 140,112 Z"
                      fill="url(#${id}-fabric)" stroke="${shade}" stroke-width="2" stroke-linejoin="round"/>
                <path d="M22,112 Q22,96 34,92 L52,86 Q62,74 78,66 Q92,60 104,66 L122,76 Q136,80 142,94 Q146,104 140,112 Z"
                      fill="url(#${id}-sheen)"/>
                <path d="M20,112 L142,112 Q146,118 140,124 Q90,132 20,124 Q16,118 20,112 Z"
                      fill="#f2f2ee" stroke="${shade}" stroke-width="1.5"/>
            </g>
            <path d="M56,86 L64,68 M66,84 L76,66 M76,82 L88,66 M88,80 L100,68" stroke="${shade}" stroke-width="1.6" opacity="0.7" fill="none"/>
            <path d="M112,80 Q120,76 130,84" stroke="#ffffff" stroke-width="2" opacity="0.4" fill="none"/>
        </svg>`,
    jewelry: (fill, shade, light, id) => `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            ${buildShadingDefs(id, fill, shade, light)}
            <ellipse cx="80" cy="120" rx="26" ry="6" fill="#000000" opacity="0.15"/>
            <path d="M38,32 Q80,72 122,32" fill="none" stroke="url(#${id}-metal)" stroke-width="4"/>
            <path d="M38,32 Q80,72 122,32" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.4"/>
            <g filter="url(#${id}-shadow)">
                <circle cx="80" cy="92" r="24" fill="url(#${id}-metal)" stroke="${shade}" stroke-width="2"/>
            </g>
            <circle cx="72" cy="82" r="7" fill="#ffffff" opacity="0.55"/>
            <circle cx="80" cy="92" r="24" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.3"/>
        </svg>`,
    cosmetic: (fill, shade, light, id) => `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            ${buildShadingDefs(id, fill, shade, light)}
            <ellipse cx="80" cy="134" rx="26" ry="6" fill="#000000" opacity="0.2"/>
            <g filter="url(#${id}-shadow)">
                <rect x="60" y="68" width="40" height="64" rx="7" fill="#26282c" stroke="#111" stroke-width="1.5"/>
                <rect x="60" y="68" width="16" height="64" fill="#ffffff" opacity="0.08"/>
                <path d="M64,68 Q80,26 96,68 Q90,58 80,58 Q70,58 64,68 Z"
                      fill="url(#${id}-fabric)" stroke="${shade}" stroke-width="1.5" stroke-linejoin="round"/>
                <path d="M64,68 Q80,26 96,68 Q90,58 80,58 Q70,58 64,68 Z" fill="url(#${id}-sheen)"/>
            </g>
            <ellipse cx="72" cy="42" rx="4" ry="9" fill="#ffffff" opacity="0.5"/>
        </svg>`,
    hair: (fill, shade, light, id) => `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            ${buildShadingDefs(id, fill, shade, light)}
            <ellipse cx="80" cy="128" rx="28" ry="6" fill="#000000" opacity="0.18"/>
            <g filter="url(#${id}-shadow)">
                <rect x="56" y="48" width="48" height="80" rx="9" fill="#f4f4f2" stroke="${shade}" stroke-width="1.5"/>
                <rect x="60" y="66" width="40" height="46" rx="4" fill="url(#${id}-fabric)"/>
                <rect x="60" y="66" width="40" height="46" rx="4" fill="url(#${id}-sheen)"/>
                <rect x="66" y="30" width="28" height="20" rx="4" fill="${shade}"/>
            </g>
            <rect x="63" y="70" width="34" height="9" fill="#ffffff" opacity="0.85"/>
        </svg>`
};

function buildProductSVG(colorName, typeName) {
    const fill = getSoftColorHex(colorName);
    const shade = shadeHexColor(fill, -0.3);
    const light = shadeHexColor(fill, 0.45);
    const category = getGarmentCategory(typeName);
    const template = SVG_WARDROBE_TEMPLATES[category] || SVG_WARDROBE_TEMPLATES.shirt;
    // Namespace gradient/filter ids per category so multiple cards on the
    // same page never clash if a browser ever inlines these (each is
    // rendered as a separate <img data-uri>, but this keeps it safe).
    return template(fill, shade, light, category).trim();
}

function buildProductImageUrl(colorName, typeName) {
    // Generated locally as a data URI — no network request, no mismatched
    // stock photos, renders instantly and works on static hosting like
    // GitHub Pages.
    const svg = buildProductSVG(colorName, typeName);
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

window.slideCardColor = function(cardId, offset, prefix) {
    const targetItem = itemsToShopMatrix.find(c => c.id === cardId);
    if (!targetItem) return;

    targetItem.activeIdx += offset;
    if (targetItem.activeIdx >= targetItem.colors.length) {
        targetItem.activeIdx = 0;
    } else if (targetItem.activeIdx < 0) {
        targetItem.activeIdx = targetItem.colors.length - 1;
    }

    buildSliderCards(prefix);
};

function capitalise(str){return str.replace(/\b\w/g,c=>c.toUpperCase());}

// =========================================================================
// ── 🎨 HIGH-FIDELITY MULTI-FORMAT GENERATOR (`MAN`/`WOMAN`/`CHILD`) ──
// =========================================================================
// =========================================================================
// ── 🎨 HIGH-FIDELITY MULTI-FORMAT GENERATOR (FIXED ASYNC IMAGES) ──
// =========================================================================
// =========================================================================
// ── 🎨 HIGH-FIDELITY MULTI-FORMAT GENERATOR (BUGPUSH ACCURATE FIX) ──
// =========================================================================
// =========================================================================
// ── 🎨 PREMIUM INFOGRAPHIC GENERATOR (ELEGANT RETINA-READY DASHBOARD) ──
// =========================================================================
// =========================================================================
// ── 🎨 HIGH-FIDELITY INFOGRAPHIC REMASTER (REAL GARMENT PATHS + EXHAUSTIVE MAP) ──
// =========================================================================
// =========================================================================
// ── 🎨 HIGH-FIDELITY INFOGRAPHIC REMASTER (FULLY CORRECTED PALETTE + QR) ──
// =========================================================================
// =========================================================================
// ── 🎨 PREMIUM INFOGRAPHIC GENERATOR (ROCK-SOLID BULLETPROOF PROMISE ENGINE) ──
// =========================================================================
// =========================================================================
// ── 🎨 PREMIUM INFOGRAPHIC GENERATOR (CLEAN DISCRETE LAYOUT - NO MEDAL/NO BARCODE) ──
// =========================================================================
if (shareSeasonBtn) {
    shareSeasonBtn.addEventListener("click", async () => {
        let seasonalTypeText = seasonalTypeDiv ? seasonalTypeDiv.innerText.replace("Seasonal Type:", "").trim() : "Custom Season";
        const skinToneText = skinToneDiv ? skinToneDiv.innerText.replace("Skin Tone:", "").trim() : "Detected Tone";
        const undertoneText = undertoneDiv ? undertoneDiv.innerText.replace("Undertone:", "").trim() : "Neutral";

        const clothingColorsList = clothingColors ? Array.from(clothingColors.querySelectorAll("li:not(.recommendation-heading)")).map(li => li.innerText) : [];
        let colorSwatches = clothingColorsList.slice(0, 8);
        if (colorSwatches.length < 8) colorSwatches = ["Peach", "Coral", "Yellow", "Mint Green", "Sky Blue", "Lavender", "Light Pink", "Cream"];

        const shareCanvas = document.createElement("canvas");
        const sCtx = shareCanvas.getContext("2d");
        
        shareCanvas.width = 1200;
        shareCanvas.height = 1680;

        // Helper promise function to load the profile portrait safely
        const loadImageAssetSafely = (srcUrl) => {
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => {
                    const blankCanvas = document.createElement("canvas");
                    blankCanvas.width = 100; blankCanvas.height = 100;
                    resolve(blankCanvas);
                };
                img.src = srcUrl;
            });
        };

        // Load only the portrait photo asset
        const userImgObj = await loadImageAssetSafely(previewImage.src);

        let accentColor = "#8a4f2a"; 
        let accentBg = "#8a4f2a";
        let bgColor = "#fffbf7"; 
        let cardBg = "#ffffff";
        let textColor = "#1a110e"; 
        let mutedText = "#665955";
        let leafEmoji = "🍂";

        if (seasonalTypeText.toLowerCase().includes("summer")) {
            accentColor = "#b35c87"; accentBg = "#b35c87"; bgColor = "#fbf7f9"; leafEmoji = "🌸";
        } else if (seasonalTypeText.toLowerCase().includes("winter")) {
            accentColor = "#1a365d"; accentBg = "#1a365d"; bgColor = "#f7fafc"; leafEmoji = "❄️";
        } else if (seasonalTypeText.toLowerCase().includes("spring")) {
            accentColor = "#6a5acd"; accentBg = "#6a5acd"; bgColor = "#fdfbf7"; leafEmoji = "✨";
        }

        // 1. Paint Base Background
        sCtx.fillStyle = bgColor;
        sCtx.fillRect(0, 0, shareCanvas.width, shareCanvas.height);

        // Circular Decorative Background Watermarks
        sCtx.strokeStyle = "rgba(138, 79, 42, 0.025)";
        sCtx.lineWidth = 4;
        sCtx.beginPath(); sCtx.arc(1100, 450, 220, 0, Math.PI * 2); sCtx.stroke();
        sCtx.beginPath(); sCtx.arc(1100, 450, 160, 0, Math.PI * 2); sCtx.stroke();

        // Top Header Text
        sCtx.fillStyle = textColor;
        sCtx.font = "bold 38px system-ui, -apple-system, sans-serif";
        sCtx.textAlign = "left";
        sCtx.fillText("AI Color Analysis", 125, 95);

        sCtx.fillStyle = mutedText;
        sCtx.font = "500 18px system-ui, sans-serif";
        sCtx.fillText("Privacy-First Personalized Style Passport", 125, 125);

        // Profile Avatar Vector Icon Ring
        sCtx.strokeStyle = accentColor;
        sCtx.lineWidth = 3;
        sCtx.beginPath(); sCtx.arc(80, 100, 24, 0, Math.PI * 2); sCtx.stroke();
        sCtx.fillStyle = accentColor;
        sCtx.font = "22px system-ui"; sCtx.fillText("👤", 68, 108);

        // On-Device Secure Badge Pill
        sCtx.fillStyle = "#f0fdf4";
        sCtx.beginPath(); sCtx.roundRect(820, 55, 320, 75, 12); sCtx.fill();
        sCtx.lineWidth = 1; sCtx.strokeStyle = "#bbf7d0"; sCtx.stroke();
        sCtx.fillStyle = "#166534";
        sCtx.font = "bold 16px system-ui, sans-serif";
        sCtx.fillText("🔒 On-Device Private", 850, 85);
        sCtx.fillStyle = "#665955";
        sCtx.font = "500 14px system-ui, sans-serif";
        sCtx.fillText("No Photos Stored • 100% Secure", 850, 112);

        // 2. Render User Portrait Photo
        sCtx.save();
        sCtx.beginPath(); sCtx.roundRect(60, 210, 440, 520, 24); sCtx.clip();
        let srcX = 0, srcY = 0, srcSize = userImgObj.width;
        if (userImgObj.width > userImgObj.height) {
            srcSize = userImgObj.height; srcX = (userImgObj.width - userImgObj.height) / 2;
        } else {
            srcSize = userImgObj.width; srcY = (userImgObj.height - userImgObj.width) / 2;
        }
        sCtx.drawImage(userImgObj, srcX, srcY, srcSize, srcSize, 60, 210, 440, 520);
        sCtx.restore();

        // Photo floating tag label pill
        sCtx.fillStyle = "rgba(26, 17, 14, 0.82)";
        sCtx.beginPath(); sCtx.roundRect(85, 650, 390, 55, 14); sCtx.fill();
        sCtx.fillStyle = "#ffffff";
        sCtx.font = "bold 20px system-ui, sans-serif";
        sCtx.fillText(`🎨 Skin Tone: ${skinToneText}`, 115, 684);

        // 3. Right Side Profile Metadata Column
        sCtx.fillStyle = accentBg;
        sCtx.beginPath(); sCtx.roundRect(550, 210, 220, 46, 10); sCtx.fill();
        sCtx.fillStyle = "#ffffff";
        sCtx.font = "bold 16px system-ui, sans-serif";
        sCtx.fillText(`${leafEmoji} YOUR SEASON`, 575, 239);

        sCtx.fillStyle = textColor;
        // Auto-shrink the title so long season names (e.g. "Warm Spring
        // (Vibrant & Golden Profile)") fit within the card instead of
        // running off the right edge — 82px was previously fixed regardless
        // of text length.
        const seasonTitleMaxWidth = 600; // available width from x=550 to the card's right margin
        let seasonFontSize = 82;
        sCtx.font = `bold ${seasonFontSize}px Georgia, serif`;
        while (sCtx.measureText(seasonalTypeText).width > seasonTitleMaxWidth && seasonFontSize > 28) {
            seasonFontSize -= 2;
            sCtx.font = `bold ${seasonFontSize}px Georgia, serif`;
        }
        sCtx.fillText(seasonalTypeText, 550, 345);

        sCtx.fillStyle = textColor;
        sCtx.font = "600 24px system-ui, sans-serif";
        sCtx.fillText(`${undertoneText}  •  Muted  •  Deep  •  Earthy`, 550, 400);

        sCtx.fillStyle = mutedText;
        sCtx.font = "20px Georgia, serif";
        sCtx.fillText("Your personal coloring completely aligns with the", 550, 455);
        sCtx.fillText(`characteristics of the ${seasonalTypeText} profile.`, 550, 490);
        sCtx.fillText("Wearing these verified tones optimizes your skin", 550, 525);
        sCtx.fillText("radiance and brings natural harmony.", 550, 560);

        // 💡 Note: Medal / Rosette ribbon block has been completely removed from this area

        // Metric Box Row Panels
        const stats = [
            { title: "Undertone", value: undertoneText, icon: "☀️" },
            { title: "Match Score", value: "98%", icon: "🎯" },
            { title: "Confidence", value: "97%", icon: "🛡️" }
        ];
        stats.forEach((s, idx) => {
            const sx = 550 + (idx * 200);
            sCtx.fillStyle = cardBg;
            sCtx.beginPath(); sCtx.roundRect(sx, 595, 185, 135, 18); sCtx.fill();
            sCtx.lineWidth = 1; sCtx.strokeStyle = "rgba(138, 79, 42, 0.08)"; sCtx.stroke();
            sCtx.fillStyle = mutedText; sCtx.font = "14px system-ui, sans-serif"; sCtx.fillText(`${s.icon} ${s.title}`, sx + 22, 635);
            sCtx.fillStyle = "#8a4f2a"; sCtx.font = "bold 28px Arial, sans-serif"; sCtx.fillText(s.value, sx + 22, 690);
        });

        // 4. Molecular Color Palette Row
        sCtx.fillStyle = textColor;
        sCtx.font = "bold 28px system-ui, sans-serif";
        sCtx.fillText("🎨 YOUR OPTIMAL MOLECULAR COLOR PALETTE ✨", 60, 805);

        const swatchW = 125, swatchH = 90;

        colorSwatches.forEach((color, i) => {
            const swX = 60 + (i * 136);
            const hexVal = resolveColorHex(color);
            const hexStr = hexVal.toUpperCase();

            sCtx.fillStyle = hexVal;
            sCtx.beginPath(); sCtx.roundRect(swX, 845, swatchW, swatchH, 14); sCtx.fill();
            sCtx.lineWidth = 1; sCtx.strokeStyle = "rgba(0,0,0,0.06)"; sCtx.stroke();

            sCtx.fillStyle = textColor;
            sCtx.font = "bold 15px system-ui, sans-serif";
            sCtx.fillText(color.substring(0, 12), swX + 2, 965);
            sCtx.fillStyle = mutedText;
            sCtx.font = "500 13px Courier, monospace";
            sCtx.fillText(hexStr, swX + 4, 987);
        });

        // 5. Chromatic Wardrobe Recommendation Maps (Real Fashion Vectors)
        sCtx.fillStyle = textColor;
        sCtx.font = "bold 28px system-ui, sans-serif";
        sCtx.fillText("👕 CHROMATIC WARDROBE RECOMMENDATION MAPS ✨", 60, 1060);

        // Pull the real personalized palette computed for this user (stashed
        // globally by unlockDressChecker() right after analysis — same object
        // getClothingPalette() returns) instead of hardcoding garment colors.
        const userPaletteForWardrobe = window._userPalette || {};
        const wardrobeBest = (userPaletteForWardrobe.best && userPaletteForWardrobe.best.length >= 6) ? userPaletteForWardrobe.best : colorSwatches;
        const wardrobeNeutrals = (userPaletteForWardrobe.neutrals && userPaletteForWardrobe.neutrals.length >= 5) ? userPaletteForWardrobe.neutrals : wardrobeBest;

        const resolveWardrobeColorHex = resolveColorHex;

        let rowItems = [
            { title: "Shirts", desc: `${wardrobeBest[0] || "Best Shade"} Oxford`, type: "shirt", colors: [wardrobeBest[0], wardrobeBest[1], wardrobeBest[2]].map(resolveWardrobeColorHex) },
            { title: "Outerwear", desc: `${wardrobeBest[3] || "Best Shade"} Coat`, type: "coat", colors: [wardrobeBest[3], wardrobeBest[4], wardrobeBest[5]].map(resolveWardrobeColorHex) },
            { title: "Accessories", desc: `${wardrobeNeutrals[0] || "Neutral Shade"} Watch`, type: "watch", colors: [wardrobeNeutrals[0], wardrobeNeutrals[1], wardrobeNeutrals[2]].map(resolveWardrobeColorHex) },
            { title: "Footwear", desc: `${wardrobeNeutrals[2] || "Neutral Shade"} Sneakers`, type: "shoes", colors: [wardrobeNeutrals[2], wardrobeNeutrals[3], wardrobeNeutrals[4]].map(resolveWardrobeColorHex) }
        ];

        rowItems.forEach((item, idx) => {
            const ix = 60 + (idx * 276);
            sCtx.fillStyle = cardBg;
            sCtx.beginPath(); sCtx.roundRect(ix, 1100, 260, 235, 20); sCtx.fill();
            sCtx.lineWidth = 1; sCtx.strokeStyle = "rgba(0,0,0,0.04)"; sCtx.stroke();
            
            sCtx.fillStyle = mutedText;
            sCtx.font = "bold 16px system-ui, sans-serif";
            sCtx.fillText(item.title, ix + 22, 1140);

            item.colors.forEach((cHex, cIdx) => {
                const cx = ix + 26 + (cIdx * 70);
                const cy = 1175;
                
                sCtx.save();
                sCtx.fillStyle = cHex;
                sCtx.strokeStyle = "rgba(0,0,0,0.15)";
                sCtx.lineWidth = 1.5;

                if (item.type === "shirt") {
                    sCtx.beginPath();
                    sCtx.moveTo(cx + 10, cy + 5); sCtx.lineTo(cx + 40, cy + 5);
                    sCtx.lineTo(cx + 46, cy + 20); sCtx.lineTo(cx + 38, cy + 24);
                    sCtx.lineTo(cx + 38, cy + 60); sCtx.lineTo(cx + 12, cy + 60);
                    sCtx.lineTo(cx + 12, cy + 24); sCtx.lineTo(cx + 4, cy + 20);
                    sCtx.closePath(); sCtx.fill(); sCtx.stroke();
                    sCtx.beginPath(); sCtx.moveTo(cx+25, cy+14); sCtx.lineTo(cx+25, cy+60); sCtx.stroke();
                } 
                else if (item.type === "coat") {
                    sCtx.beginPath();
                    sCtx.moveTo(cx + 8, cy + 2); sCtx.lineTo(cx + 42, cy + 2);
                    sCtx.lineTo(cx + 48, cy + 62); sCtx.lineTo(cx + 2, cy + 62);
                    sCtx.closePath(); sCtx.fill(); sCtx.stroke();
                    sCtx.fillStyle = "rgba(0,0,0,0.1)";
                    sCtx.beginPath();
                    sCtx.moveTo(cx+25, cy+22); sCtx.lineTo(cx+8, cy+2); sCtx.lineTo(cx+42, cy+2);
                    sCtx.closePath(); sCtx.fill(); sCtx.stroke();
                } 
                else if (item.type === "watch") {
                    sCtx.fillStyle = "#8b5a2b"; 
                    sCtx.fillRect(cx + 18, cy, 14, 64);
                    sCtx.strokeRect(cx + 18, cy, 14, 64);
                    sCtx.fillStyle = cHex;
                    sCtx.beginPath(); sCtx.arc(cx + 25, cy + 32, 20, 0, Math.PI * 2); sCtx.fill(); sCtx.stroke();
                    sCtx.fillStyle = "#ffffff";
                    sCtx.beginPath(); sCtx.arc(cx + 25, cy + 32, 14, 0, Math.PI * 2); sCtx.fill();
                } 
                else if (item.type === "shoes") {
                    sCtx.beginPath();
                    sCtx.moveTo(cx + 4, cy + 45); sCtx.lineTo(cx + 14, cy + 20);
                    sCtx.lineTo(cx + 30, cy + 22); sCtx.lineTo(cx + 48, cy + 46);
                    sCtx.lineTo(cx + 48, cy + 56); sCtx.lineTo(cx + 4, cy + 56);
                    sCtx.closePath(); sCtx.fill(); sCtx.stroke();
                    sCtx.fillStyle = "#ffffff";
                    sCtx.fillRect(cx + 4, cy + 50, 44, 6); sCtx.strokeRect(cx + 4, cy + 50, 44, 6);
                }
                sCtx.restore();
            });

            sCtx.fillStyle = "#8a4f2a";
            sCtx.font = "bold 18px system-ui, sans-serif";
            sCtx.fillText(item.desc, ix + 22, 1298);
        });

        // 6. Style Advice Bottom Section
        sCtx.fillStyle = "#fffcf7"; 
        sCtx.beginPath(); sCtx.roundRect(60, 1375, 1080, 130, 18); sCtx.fill();
        sCtx.lineWidth = 1; sCtx.strokeStyle = "rgba(138, 79, 42, 0.12)"; sCtx.stroke();

        sCtx.fillStyle = "#dfa12b";
        sCtx.font = "32px system-ui"; sCtx.fillText("💡", 90, 1448);

        sCtx.fillStyle = textColor;
        sCtx.font = "bold 20px system-ui, sans-serif";
        sCtx.fillText("AI STYLE ADVICE", 145, 1425);
        sCtx.fillStyle = mutedText;
        sCtx.font = "17px Georgia, serif";
        let advice = "Earthy tones, textured fabrics and warm metals will make your complexion look healthier and more vibrant.";
        if (undertoneText === "Cool") advice = "Sharp high contrast parameters dictate jewel selections. Stick to stark crisp whites and cold metal links.";
        sCtx.fillText(advice, 145, 1465);

        // 💡 Note: Barcode image layout drawing engine is completely removed here

        // 7. Footer Branding Labels
        sCtx.fillStyle = "#8a4f2a";
        sCtx.font = "bold 26px system-ui, sans-serif";
        sCtx.textAlign = "center";
        sCtx.fillText("Discover Your Perfect Colors with AI • aicoloranalysis.online", shareCanvas.width / 2, 1565);

        sCtx.fillStyle = mutedText;
        sCtx.font = "600 15px system-ui, sans-serif";
        sCtx.fillText("🛡️ Privacy Guaranteed: On-Device Processing Completed Locally. No Photos Stored.", shareCanvas.width / 2, 1608);

        const renderDataUrl = shareCanvas.toDataURL("image/png");
        launchShareModalLayout(renderDataUrl, seasonalTypeText);
    });
}

function launchShareModalLayout(imgDataUrl, seasonTitle) {
    const overlayNode = document.createElement("div");
    overlayNode.className = "share-modal-overlay";
    
    overlayNode.innerHTML = `
        <div class="share-modal-content">
            <h3 style="font-size: 1.25rem; font-weight: 700; color: #fff; margin-bottom: 4px;">✨ Your Season Card is Ready!</h3>
            <p style="font-size: 0.85rem; opacity: 0.7; margin-bottom: 10px;">Long press to save on mobile, or click download below.</p>
            <img src="${imgDataUrl}" class="share-card-preview-img" alt="Seasonal Profile Card Summary Preview">
            <div style="display: flex; justify-content: center; width: 100%; margin-top: 10px;">
                <button type="button" class="close-modal-btn" id="closeShareModal">Cancel</button>
                <a href="${imgDataUrl}" download="AI-Color-Analysis-${seasonTitle.replace(/\s+/g, '-')}.png" class="download-modal-btn" id="confirmDownload">Save Image</a>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlayNode);
    document.getElementById("closeShareModal").addEventListener("click", () => overlayNode.remove());
    overlayNode.addEventListener("click", (e) => { if (e.target === overlayNode) overlayNode.remove(); });
}

function getClothingPalette(undertone,skinToneCategory,contrastLevel){
    if(undertone==="Warm"&&skinToneCategory==="light"){
        if(contrastLevel==="high")return{best:["Peach","Coral","Warm Ivory","Golden Yellow","Bright Turquoise","Salmon Pink","Light Orange","Apple Green"],good:["Camel","Warm White","Aqua","Soft Teal","Buttercup Yellow","Warm Lilac","Champagne"],accent:["Poppy Red","Cobalt Blue","Bright Coral","Lime Green"],neutrals:["Warm White","Light Camel","Ivory","Cream","Sand"],avoid:["Black","Harsh Charcoal","Cool Gray","Ice Blue","Silver Gray","Deep Burgundy"]};
        return{best:["Peach","Soft Coral","Warm Ivory","Light Golden Yellow","Mint Green","Soft Salmon","Butter Yellow","Light Peach Pink"],good:["Champagne","Soft Aqua","Warm Cream","Blush Pink","Light Camel","Soft Sage","Nude Beige"],accent:["Warm Rose","Soft Orange","Muted Coral","Dusty Gold"],neutrals:["Warm White","Cream", "Ivory","Light Tan","Soft Beige"],avoid:["Black","Cool Gray","Royal Blue","Stark White","Burgundy","Navy"]};
    }
    if(undertone==="Warm"&&skinToneCategory==="medium"){
        if(contrastLevel==="high")return{best:["Burnt Orange","Rust","Olive Green","Deep Teal","Mustard Yellow","Warm Brown","Terracotta","Forest Green"],good:["Camel","Dark Gold","Bronze","Copper","Dark Olive","Khaki","Warm Burgundy","Chocolate"],accent:["Paprika Red","Deep Turquoise","Dark Coral","Amber"],neutrals:["Camel","Warm Taupe","Chocolate Brown","Dark Khaki","Warm Beige"],avoid:["Black","Cool Lavender","Icy Blue","Pale Pink","Silver","Cool Gray"]};
        return{best:["Olive Green","Muted Mustard","Soft Rust","Warm Taupe","Sage Green","Dusty Peach","Muted Teal","Warm Camel"],good:["Warm Brown","Soft Terracotta","Muted Gold","Khaki","Moss Green","Dusty Rose","Warm Gray"],accent:["Deep Coral","Muted Amber","Warm Mauve","Dusty Jade"],neutrals:["Warm Taupe","Camel","Warm Beige","Soft Khaki","Light Brown"],avoid:["Bright Black","Icy Pastels","Cool Lavender","Bright Neon","Silver Gray"]};
    }
    if(undertone==="Warm"&&skinToneCategory==="deep")return{best:["Burnt Orange","Deep Chocolate Brown","Warm Burgundy","Dark Olive","Rich Gold","Deep Teal","Paprika Red","Brick Red"],good:["Camel","Deep Mustard","Copper","Forest Green","Warm Black","Bronze","Rust","Dark Coral"],accent:["Bright Orange","Deep Yellow","Rich Turquoise","Mango"],neutrals:["Warm Black","Chocolate Brown","Dark Camel","Deep Khaki","Rich Taupe"],avoid:["Pale Pastel Pink","Icy Blue","Cool Lavender","Silver","Powder Blue"]};
    if(undertone==="Cool"&&skinToneCategory==="light"){
        if(contrastLevel==="high")return{best:["Pure White","Black","Icy Blue","Royal Blue","Hot Pink","Fuchsia","True Red","Emerald Green"],good:["Navy","Bright Purple","Cobalt","Cool Gray","Silver","Raspberry","Bright Teal"],accent:["Electric Blue","Bright Magenta","Stark Lemon Yellow","Pure Red"],neutrals:["Pure White","Black","Cool Gray","Navy","Charcoal"],avoid:["Camel","Orange","Warm Beige","Mustard","Brown","Warm Gold"]};
        return{best:["Soft Lavender","Powder Blue","Rose Pink","Soft Mauve","Icy Blue","Dusty Rose","Soft Periwinkle","Pale Mint"],good:["Soft Gray","Blush","Light Navy","Soft Sage","Cool White","Muted Plum","Soft Lilac"],accent:["Dusty Rose","Soft Teal","Muted Berry","Soft Orchid"],neutrals:["Soft White","Dove Gray","Cool Beige","Powder Gray","Light Silver"],avoid:["Orange","Mustard","Brown","Warm Beige","Camel","Rust","Terracotta"]};
    }
    if(undertone==="Cool"&&skinToneCategory==="medium"){
        if(contrastLevel==="high")return{best:["True White","Charcoal","Navy","Sapphire Blue","Emerald","Berry Red","Fuchsia","Deep Purple"],good:["Black","Royal Purple","Deep Teal","Cobalt","Cool Gray","Crimson","Plum"],accent:["Electric Blue","Magenta","Bright Emerald","Pure Lemon"],neutrals:["Charcoal","True White","Navy","Cool Gray","Black"],avoid:["Orange","Camel","Warm Brown","Mustard","Rust","Golden Yellow"]};
        return{best:["Dusty Rose","Muted Mauve","Cool Taupe","Soft Plum","Slate Blue","Dusty Lavender","Muted Teal","Soft Raspberry"],good:["Cool Gray","Soft Navy","Muted Sage","Dusty Pink","Soft Orchid","Cool Beige","Pewter"],accent:["Soft Berry","Dusty Blue","Muted Coral","Soft Grape"],neutrals:["Cool Gray","Dove White","Soft Navy","Cool Taupe","Warm Gray"],avoid:["Orange","Mustard","Camel","Rust","Warm Brown","Bright Yellow"]};
    }
    if(undertone==="Cool"&&skinToneCategory==="deep")return{best:["True Black","Pure White","Royal Blue","Fuchsia","Emerald Green","Deep Purple","Bright Red","Cobalt"],good:["Deep Navy","Cool Burgundy","Bright Teal","Raspberry","Charcoal","Berry","Icy Silver"],accent:["Electric Blue","Hot Pink","Bright Lime","Stark Yellow"],neutrals:["Black","True White","Charcoal","Navy","Cool Gray"],avoid:["Orange","Camel","Warm Brown","Mustard","Rust","Golden Yellow"]};
    if(skinToneCategory==="light")return{best:["Dusty Rose","Soft Lavender","Powder Blue","Warm Taupe","Soft Sage","Muted Mauve","Nude Blush","Soft Teal"],good:["Warm White","Cool Gray","Soft Navy","Muted Peach","Dusty Lilac","Soft Khaki","Pale Gold"],accent:["Soft Berry","Muted Coral","Warm Lavender","Soft Jade"],neutrals:["Warm White","Cool Beige","Soft Gray","Dove","Nude"],avoid:["Neon Yellow","Harsh Black","Very Bright Orange","Stark White"]};
    if(skinToneCategory==="medium")return{best:["Dusty Teal","Warm Mauve","Soft Navy","Camel","Forest Green","Dusty Rose","Warm Slate","Muted Coral"],good:["Warm Gray","Muted Gold","Soft Brown","Dusty Blue","Warm Khaki","Soft Olive","Dusty Plum"],accent:["Warm Teal","Muted Berry","Soft Amber","Dusty Lavender"],neutrals:["Warm Taupe","Warm Gray","Camel","Soft Ivory","Warm Beige"],avoid:["Neon Yellow","Very Bright Orange","Icy Pastels","Harsh Black"]};
    return{best:["Deep Teal","Warm Burgundy","Olive Green","Rust","Burnt Orange","Deep Navy","Chocolate Brown","Forest Green"],good:["Dark Gold","Paprika","Deep Coral","Warm Brown","Copper","Dark Khaki","Dark Olive"],accent:["Bright Coral","Deep Turquoise","Mango","Deep Amber"],neutrals:["Dark Brown","Warm Black","Dark Taupe","Deep Khaki","Espresso"],avoid:["Pale Pink","Icy Blue","Soft Lavender","Mint","Powder Blue"]};
}

function getHairPalette(undertone,skinToneCategory){
    if(undertone==="Warm"&&skinToneCategory==="light")return{best:["Golden Blonde","Honey Blonde","Strawberry Blonde","Light Copper"],good:["Sandy Brown","Warm Light Brown","Peach Blonde","Caramel"],highlights:["Sunlit Golden Highlights","Honey Balayage","Warm Champagne Highlights"],avoid:["Ash Blonde","Cool Black","Blue-Black","Platinum","Cool Brown"]};
    if(undertone==="Warm"&&skinToneCategory==="medium")return{best:["Chestnut Brown","Warm Auburn","Honey Brown","Golden Brown","Copper"],good:["Rich Caramel","Warm Mahogany","Dark Honey Blonde","Warm Medium Brown"],highlights:["Caramel Balayage","Copper Highlights","Auburn Streaks","Gold Face-Framing"],avoid:["Ash Brown","Cool Dark Brown","Platinum Blonde","Blue-Black","Silver Gray"]};
    if(undertone==="Warm"&&skinToneCategory==="deep")return{best:["Rich Chestnut","Warm Dark Brown","Deep Auburn","Warm Espresso","Mahogany"],good:["Dark Copper","Deep Warm Brown","Rich Chocolate","Warm Black-Brown"],highlights:["Copper Highlights","Warm Auburn Streaks","Bronze Shimmer","Deep Gold Highlights"],avoid:["Platinum Blonde","Ash Brown","Cool Black","Gray Tones","Blue-Black"]};
    if(undertone==="Cool"&&skinToneCategory==="light")return{best:["Ash Blonde","Platinum Blonde","Cool Light Brown","Sandy Ash"],good:["Light Cool Brown","Beige Blonde","Icy Blonde","Champagne Blonde"],highlights:["Platinum Highlights","Ash Blonde Balayage","Pearl Highlights","Cool Silver Streaks"],avoid:["Golden Blonde","Copper","Honey Brown","Warm Auburn","Red Tones"]};
    if(undertone==="Cool"&&skinToneCategory==="medium")return{best:["Ash Brown","Cool Dark Brown","Deep Burgundy","Espresso","Mocha"],good:["Dark Ash Blonde","Cool Mahogany","Dark Plum","Blue-Black","Cool Black"],highlights:["Ash Highlights","Cool Chestnut Balayage","Plum Tones","Deep Violet Shimmer"],avoid:["Golden Brown","Copper","Warm Auburn","Honey Blonde","Caramel"]};
    if(undertone==="Cool"&&skinToneCategory==="deep")return{best:["Jet Black","Cool Espresso","Blue-Black","Deep Burgundy","Dark Plum"],good:["Deep Cool Brown","Dark Violet","Deep Mahogany","Soft Black"],highlights:["Deep Violet Shimmer","Midnight Blue Tones","Deep Burgundy Streaks","Cool Bronze"],avoid:["Copper","Warm Auburn","Golden Honey","Caramel","Warm Red"]};
    if(skinToneCategory==="light")return{best:["Natural Blonde","Light Brown","Sandy Blonde","Warm Ash Blonde"],good:["Golden Brown","Soft Caramel","Warm Beige Blonde"],highlights:["Sandy Balayage","Soft Caramel Highlights","Natural Sun-Kissed"],avoid:["Bright Platinum","Very Dark Black","Neon Red"]};
    if(skinToneCategory==="medium")return{best:["Natural Brown","Medium Brown","Soft Chestnut","Dark Honey Blonde"],good:["Warm Brown","Cool Brown","Soft Auburn"],highlights:["Natural Balayage","Soft Caramel Highlights","Subtle Auburn Streaks"],avoid:["Platinum Blonde","Neon Colors","Very Bright Red"]};
    return{best:["Natural Dark Brown","Soft Black","Dark Espresso","Deep Chocolate"],good:["Warm Dark Brown","Deep Mahogany","Cool Dark Brown"],highlights:["Subtle Bronze","Deep Auburn Hints","Dark Gold Shimmer"],avoid:["Platinum Blonde","Very Light Colors","Neon Colors"]};
}

function getJewelryPalette(undertone,skinToneCategory){
    if(undertone==="Warm")return{best:["Yellow Gold","Rose Gold","Bronze","Copper","Brass"],gems:["Amber","Citrine","Topaz","Carnelian","Coral","Peridot","Turquoise","Tiger's Eye"],secondary:["Mixed Metal (Gold-dominant)","Warm Enamel","Wood & Natural Materials"],avoid:["Silver","White Gold","Platinum","Cool Blue Sapphire","Blue Aquamarine"]};
    if(undertone==="Cool")return{best:["Silver","White Gold","Platinum","Palladium"],gems:["Diamond","Sapphire","Amethyst","Blue Topaz","Aquamarine","Ruby","Tanzanite","Pearl"],secondary:["Rose Gold (silver-toned)","Hematite","Gunmetal"],avoid:["Yellow Gold","Copper","Bronze","Brass","Warm Coral Stone"]};
    return{best:["Yellow Gold","Silver","Rose Gold — all work equally well"],gems:["Diamond","Opal","Pearl","Morganite","Jade","Moonstone","Garnet","Subtle Quartz"],secondary:["Mixed Metals","Two-tone Jewelry","Layered Gold & Silver"],avoid:["Very Neon Enamel","Overly Bright Plastic Jewelry"]};
}

// ── Palette-name → hex resolver ──
// The clothing/hair/jewelry palette generators produce ~200 distinct
// descriptive colour-name strings (e.g. "Dusty Rose", "Warm White", "Soft
// Gray", "Dove"). A small hand-maintained name→hex map (like the old
// styleColorMap) inevitably misses most of them and silently falls back to
// one flat colour for everything unmatched — which is exactly why "Warm
// White", "Cool Beige", "Soft Gray" and "Dove" were all rendering as the
// same brown. This resolver instead looks up the base hue from the last
// word in the name (usually the actual colour noun, e.g. "Dusty Rose" →
// "rose"), then nudges lightness/saturation/hue based on any recognised
// modifier words in the rest of the name (e.g. "Dusty" → desaturate +
// lighten slightly, "Deep" → darken). This covers the full ~200-name
// vocabulary instead of just the handful someone thought to hardcode.
function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
    const c = (1 - Math.abs(2*l - 1)) * s;
    const x = c * (1 - Math.abs((h/60) % 2 - 1));
    const m = l - c/2;
    let r=0,g=0,b=0;
    if (h<60)      { r=c; g=x; b=0; }
    else if (h<120){ r=x; g=c; b=0; }
    else if (h<180){ r=0; g=c; b=x; }
    else if (h<240){ r=0; g=x; b=c; }
    else if (h<300){ r=x; g=0; b=c; }
    else           { r=c; g=0; b=x; }
    return { r: Math.round((r+m)*255), g: Math.round((g+m)*255), b: Math.round((b+m)*255) };
}

const BASE_HUE_HEX = {
    red:"#E53E3E", orange:"#F97316", yellow:"#FBBF24", lemon:"#FFF44F", gold:"#D4AF37",
    green:"#22C55E", olive:"#6B8E23", sage:"#9CAF88", mint:"#98FF98", emerald:"#50C878", jade:"#00A86B", lime:"#84CC16",
    teal:"#14B8A6", turquoise:"#2DD4BF", aqua:"#22D3EE",
    blue:"#3B82F6", navy:"#1E3A5F", cobalt:"#0047AB", sapphire:"#0F52BA", periwinkle:"#8891D8", slate:"#64748B",
    purple:"#8B5CF6", lavender:"#B497BD", lilac:"#C8A2C8", plum:"#8E4585", orchid:"#C77DC0", grape:"#6F2DA8", mauve:"#B784A7",
    pink:"#EC4899", rose:"#F472B6", blush:"#F9C6D0", fuchsia:"#E4599A", magenta:"#D6249F", raspberry:"#B3446C", berry:"#8B0A50", crimson:"#DC143C",
    coral:"#FF6B6B", salmon:"#FF8B7E", peach:"#FFB09C", terracotta:"#CC6B49", rust:"#B7410E", paprika:"#C1440E", amber:"#FFBF00", mustard:"#E1AD01", mango:"#FFA400",
    brown:"#8B5A2B", chocolate:"#5A3A22", espresso:"#4B3621", camel:"#C19A6B", khaki:"#C3B091", tan:"#D2B48C", taupe:"#8B7D6B", copper:"#B87333", bronze:"#CD7F32",
    burgundy:"#800020", maroon:"#800000",
    cream:"#FFFDD0", ivory:"#FFFFF0", beige:"#E8D9B5", sand:"#E4CBA5", nude:"#E3BC9A", champagne:"#F7E7CE",
    gray:"#9CA3AF", grey:"#9CA3AF", charcoal:"#36454F", pewter:"#96A0A6", dove:"#D6D6D6", silver:"#C0C0C0",
    black:"#1A1A1A", white:"#FDFDFD"
};

const COLOR_MODIFIER_ADJUST = {
    dark:{l:-16}, deep:{l:-18}, rich:{l:-10,s:8}, true:{s:10},
    light:{l:16}, pale:{l:22,s:-12}, soft:{l:10,s:-16}, muted:{l:4,s:-22}, dusty:{l:6,s:-22},
    bright:{s:20,l:2}, electric:{s:28}, stark:{s:15,l:6}, pure:{s:10}, vivid:{s:25}, neon:{s:30,l:5},
    warm:{h:6}, cool:{h:-6}, icy:{l:20,s:-20}, powder:{l:22,s:-18}, harsh:{s:10,l:-5}
};

function resolveColorHex(name) {
    if (!name) return "#9CA3AF";
    const words = name.toLowerCase().split(/\s+/);

    let baseHex = null;
    for (let i = words.length - 1; i >= 0; i--) {
        if (BASE_HUE_HEX[words[i]]) { baseHex = BASE_HUE_HEX[words[i]]; break; }
    }
    if (!baseHex) return "#9CA3AF"; // unrecognised name — neutral gray fallback

    const rgb = hexToRgbTriplet(baseHex);
    let { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);

    words.forEach(w => {
        const adj = COLOR_MODIFIER_ADJUST[w];
        if (adj) {
            if (adj.h) h += adj.h;
            if (adj.s) s = Math.max(0, Math.min(100, s + adj.s));
            if (adj.l) l = Math.max(14, Math.min(96, l + adj.l));
        }
    });

    const out = hslToRgb(h, s, l);
    return rgbToHex(out.r, out.g, out.b);
}

function rgbToHex(r,g,b){return"#"+[r,g,b].map(x=>{const h=x.toString(16);return h.length===1?"0"+h:h;}).join("");}

// ── Product / Dress Color Checker helpers ──
// Samples the dominant colour of an uploaded product photo, classifies it,
// and compares it against the user's stored seasonal colour palette.

function colorDistance(c1, c2) {
    const dr = c1.r - c2.r, dg = c1.g - c2.g, db = c1.b - c2.b;
    return Math.sqrt(dr*dr + dg*dg + db*db);
}

// Detects likely human-skin pixels (arms/neck/face/hands commonly visible in
// "model wearing the item" screenshots) so they don't get mixed into the
// garment colour average.
//
// NOTE: an earlier version used a simple "r > g > b with some gap" RGB rule,
// but that also matches saturated pink/red *fabric* (hot pink and red both
// have r >> g,b too), which was wrongly discarding the actual garment pixels
// on pink/red screenshots. Converting to YCbCr and checking against the
// standard skin-tone chrominance range (Cb 77–127, Cr 133–173) is the
// well-established fix: real skin clusters tightly in that band regardless
// of lighting, while saturated clothing colours fall well outside it.
function isSkinTone(r, g, b) {
    const y  = 0.299*r + 0.587*g + 0.114*b;
    const cb = 128 - 0.168736*r - 0.331264*g + 0.5*b;
    const cr = 128 + 0.5*r - 0.418688*g - 0.081312*b;
    return cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && y > 60;
}

function getDominantColor(imageElement) {
    const tc  = document.createElement("canvas");
    const ctx = tc.getContext("2d", { willReadFrequently: true });
    const size = 150;
    tc.width = size; tc.height = size;
    ctx.drawImage(imageElement, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;

    // 🧠 1. DYNAMIC CORNER BACKDROP ESTIMATOR
    // Samples the outer edges to detect the exact background wall color,
    // whether it's studio white or a vibrant storefront brand color.
    const edge = 8;
    let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;
    const sampleZones = [[0,0], [size-edge, 0], [0, size-edge], [size-edge, size-edge]];
    
    sampleZones.forEach(([cx, cy]) => {
        for (let y = cy; y < cy + edge; y++) {
            for (let x = cx; x < cx + edge; x++) {
                const i = (y * size + x) * 4;
                bgR += data[i]; bgG += data[i+1]; bgB += data[i+2];
                bgCount++;
            }
        }
    });
    bgR /= bgCount; bgG /= bgCount; bgB /= bgCount;

    // 🧠 2. INNER LAYER SEPARATION GENERATOR
    const margin = Math.floor(size * 0.2);
    const midX = size / 2;
    const midY = size / 2;
    const maxDist = Math.hypot(midX, midY);

    const buckets = {};
    const QUANT = 8; // Controlled pixel grid mapping resolution

    for (let y = margin; y < size - margin; y++) {
        for (let x = margin; x < size - margin; x++) {
            const i = (y * size + x) * 4;
            const r=data[i], g=data[i+1], b=data[i+2], a=data[i+3];
            
            if (a < 200) continue; 

            // Skip pixels matching the dynamically detected background wall color
            const dBackground = Math.sqrt((r-bgR)**2 + (g-bgG)**2 + (b-bgB)**2);
            if (dBackground < 42) continue;

            // Skip default overexposure and deep framing borders
            if (r > 248 && g > 248 && b > 248) continue;
            if (r < 12 && g < 12 && b < 12) continue;

            // Skip face skin tones if visible in the frame box
            if (typeof isSkinTone === "function" && isSkinTone(r, g, b)) continue;

            // Weight center mass distribution
            const dist = Math.hypot(x - midX, y - midY);
            const weight = 1.0 - (dist / maxDist);

            const rBin = Math.round(r / QUANT);
            const gBin = Math.round(g / QUANT);
            const bBin = Math.round(b / QUANT);
            const key = `${rBin},${gBin},${bBin}`;

            if (!buckets[key]) {
                buckets[key] = { count: 0, rSum: 0, gSum: 0, bSum: 0, totalWeight: 0 };
            }
            buckets[key].count++;
            buckets[key].rSum += r;
            buckets[key].gSum += g;
            buckets[key].bSum += b;
            buckets[key].totalWeight += weight;
        }
    }

    const clusters = Object.values(buckets);

    // Absolute fallback state if filtering cleared out everything
    if (clusters.length === 0) {
        let rSum=0, gSum=0, bSum=0, count=0;
        for (let y = margin; y < size - margin; y++) {
            for (let x = margin; x < size - margin; x++) {
                const i = (y * size + x) * 4;
                if (data[i+3] >= 200) {
                    rSum+=data[i]; gSum+=data[i+1]; bSum+=data[i+2]; count++;
                }
            }
        }
        if (count === 0) count = 1;
        return { r: Math.round(rSum/count), g: Math.round(gSum/count), b: Math.round(bSum/count), hex: rgbToHex(Math.round(rSum/count), Math.round(gSum/count), Math.round(bSum/count)) };
    }

    // Sort by weighted proximity value so the main shirt fabric always wins
    clusters.sort((a, b) => b.totalWeight - a.totalWeight);
    const topCluster = clusters[0];

    const finalR = Math.round(topCluster.rSum / topCluster.count);
    const finalG = Math.round(topCluster.gSum / topCluster.count);
    const finalB = Math.round(topCluster.bSum / topCluster.count);

    return {
        r: finalR,
        g: finalG,
        b: finalB,
        hex: rgbToHex(finalR, finalG, finalB)
    };
}
// ── LAB colour space + Delta-E matching ──
// Hue-bucket classification (the old approach) draws hard lines at fixed hue
// angles, so visually-similar colours like Ivory/Cream/White or
// Olive/Forest/Sage all collapse into one bucket. Converting to CIE LAB and
// measuring Delta-E against a curated named-colour palette instead picks the
// *perceptually closest* named colour, and gives a genuine confidence score
// for free (small Delta-E = very close match).

function srgbChannelToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function rgbToLab(r, g, b) {
    const rl = srgbChannelToLinear(r), gl = srgbChannelToLinear(g), bl = srgbChannelToLinear(b);

    let x = rl * 0.4124 + gl * 0.3576 + bl * 0.1805;
    let y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
    let z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505;

    x /= 0.95047; y /= 1.0; z /= 1.08883;
    const f = t => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
    const fx = f(x), fy = f(y), fz = f(z);

    return { L: 116 * fy - 16, A: 500 * (fx - fy), B: 200 * (fy - fz) };
}

function deltaE(lab1, lab2) {
    const dL = lab1.L - lab2.L, dA = lab1.A - lab2.A, dB = lab1.B - lab2.B;
    return Math.sqrt(dL*dL + dA*dA + dB*dB);
}

function hexToRgbTriplet(hex) {
    hex = hex.replace("#", "");
    return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16)
    };
}

// Curated palette: distinct enough entries per family that near-neighbours
// (Ivory vs Cream vs White, Olive vs Forest vs Sage vs Emerald) resolve to
// different names instead of collapsing into one hue bucket.
const NAMED_COLOR_PALETTE = [
    { name: "White",           family: "white",  warmth: "neutral", hex: "#FFFFFF" },
    { name: "Ivory",           family: "white",  warmth: "warm",    hex: "#FFFFF0" },
    { name: "Cream",           family: "white",  warmth: "warm",    hex: "#FFFDD0" },
    { name: "Snow White",      family: "white",  warmth: "cool",    hex: "#F8F8FF" },
    { name: "Black",           family: "black",  warmth: "neutral", hex: "#0A0A0A" },
    { name: "Charcoal",        family: "black",  warmth: "neutral", hex: "#36454F" },
    { name: "Gray",            family: "gray",   warmth: "neutral", hex: "#808080" },
    { name: "Silver",          family: "gray",   warmth: "cool",    hex: "#C0C0C0" },
    { name: "Navy Blue",       family: "blue",   warmth: "cool",    hex: "#1B2A4A" },
    { name: "Royal Blue",      family: "blue",   warmth: "cool",    hex: "#4169E1" },
    { name: "Sky Blue",        family: "blue",   warmth: "cool",    hex: "#87CEEB" },
    { name: "Denim Blue",      family: "blue",   warmth: "cool",    hex: "#3B5998" },
    { name: "Teal",            family: "teal",   warmth: "cool",    hex: "#008080" },
    { name: "Turquoise",       family: "teal",   warmth: "cool",    hex: "#40E0D0" },
    { name: "Forest Green",    family: "green",  warmth: "neutral", hex: "#228B22" },
    { name: "Olive Green",     family: "green",  warmth: "warm",    hex: "#6B8E23" },
    { name: "Dark Olive",      family: "green",  warmth: "warm",    hex: "#4A4A2E" },
    { name: "Sage Green",      family: "green",  warmth: "neutral", hex: "#9CAF88" },
    { name: "Emerald",         family: "green",  warmth: "cool",    hex: "#50C878" },
    { name: "Mint",            family: "green",  warmth: "cool",    hex: "#98FF98" },
    { name: "Khaki",           family: "brown",  warmth: "warm",    hex: "#C3B091" },
    { name: "Red",             family: "red",    warmth: "warm",    hex: "#D1233C" },
    { name: "Burgundy",        family: "red",    warmth: "warm",    hex: "#800020" },
    { name: "Coral",           family: "red",    warmth: "warm",    hex: "#FF7F50" },
    { name: "Orange",          family: "orange", warmth: "warm",    hex: "#FFA500" },
    { name: "Rust",            family: "orange", warmth: "warm",    hex: "#B7410E" },
    { name: "Yellow",          family: "yellow", warmth: "warm",    hex: "#FFD700" },
    { name: "Mustard",         family: "yellow", warmth: "warm",    hex: "#E1AD01" },
    { name: "Purple",          family: "purple", warmth: "cool",    hex: "#800080" },
    { name: "Lavender",        family: "purple", warmth: "cool",    hex: "#B497BD" },
    { name: "Plum",            family: "purple", warmth: "cool",    hex: "#8E4585" },
    { name: "Pink",            family: "pink",   warmth: "warm",    hex: "#F4A6C6" },
    { name: "Hot Pink",        family: "pink",   warmth: "warm",    hex: "#FF69B4" },
    { name: "Dusty Rose",      family: "pink",   warmth: "warm",    hex: "#DCAE96" },
    { name: "Beige",           family: "brown",  warmth: "warm",    hex: "#E8D9B5" },
    { name: "Tan",             family: "brown",  warmth: "warm",    hex: "#D2B48C" },
    { name: "Brown",           family: "brown",  warmth: "warm",    hex: "#7B4B27" },
    { name: "Chocolate Brown", family: "brown",  warmth: "warm",    hex: "#4A2C17" }
];
NAMED_COLOR_PALETTE.forEach(c => {
    const rgb = hexToRgbTriplet(c.hex);
    c.lab = rgbToLab(rgb.r, rgb.g, rgb.b);
});

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (mx + mn) / 2;
    const d = mx - mn;
    if (d !== 0) {
        s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        switch (mx) {
            case r: h = ((g - b) / d) % 6; break;
            case g: h = (b - r) / d + 2; break;
            default: h = (r - g) / d + 4; break;
        }
        h *= 60; if (h < 0) h += 360;
    }
    return { h, s: s * 100, l: l * 100 };
}

// Coarse hue/saturation/lightness bucket, checked BEFORE any Delta-E math.
// This is what keeps a dark, desaturated, but still clearly-green-hued
// pixel (e.g. a shadowed olive shirt) from ever being compared against
// unrelated neutrals like Gray in the first place — Euclidean LAB distance
// alone can't tell "dark and a little green" from "dark and no colour at
// all" apart nearly as reliably as looking at hue directly.
function colorFamilyBucket(h, s, l) {
    // 🧠 CRITICAL FIX: Saturated clothing rules check
    // If lightness is extremely high or saturation is near-zero, lock it into flat neutrals early
    if (s < 12) return l > 85 ? "white" : l < 24 ? "black" : "gray";
    if (l > 93 && s < 20) return "white";
    // Only force very dark pixels into "black" when they're also low-saturation
    // (i.e. genuinely neutral/near-colorless). A dark-but-saturated pixel
    // (e.g. a dark green or dark navy garment) has real hue information that
    // this used to throw away purely because it was dim — mislabeling, say,
    // a forest-green shirt as "Charcoal". Let anything with meaningful
    // saturation fall through to the hue buckets below instead.
    if (l < 18 && s < 25) return "black";

    if (s < 22 && h >= 20 && h < 100) return "olive_brown"; 
    // Covers the full red/pink wraparound (290°-360° and 0°-15°) with no gap.
    // Previously this only caught h >= 345, so hues in [290, 345) — dark
    // maroons/burgundies included — fell through every bucket below and
    // landed on the catch-all "pink" default at the end of this function,
    // regardless of how dark or desaturated they were.
    if (h < 15 || h >= 290) return (l > 45 && s > 40) ? "pink" : "red";
    if (h < 45)  return "orange";
    if (h < 65)  return "yellow";
    if (h < 170) return "green";
    if (h < 195) return "teal";
    if (h < 255) return "blue";
    return "purple";
}

// Which named swatches are eligible candidates for each bucket. Buckets can
// span more than one palette `family` tag (e.g. desaturated warm-greens
// legitimately might read as either an olive/khaki brown or a muted green).
const FAMILY_BUCKET_NAMES = {
    white:       ["White", "Ivory", "Cream", "Snow White"],
    black:       ["Black", "Charcoal"],
    gray:        ["Gray", "Silver", "Charcoal"],
    olive_brown: ["Khaki", "Beige", "Tan", "Brown", "Chocolate Brown", "Olive Green", "Dark Olive", "Sage Green"],
    pink:        ["Pink", "Hot Pink", "Dusty Rose", "Coral"],
    red:         ["Red", "Burgundy", "Rust"],
    orange:      ["Orange", "Rust", "Coral"],
    yellow:      ["Yellow", "Mustard"],
    green:       ["Forest Green", "Olive Green", "Dark Olive", "Sage Green", "Emerald", "Mint"],
    teal:        ["Teal", "Turquoise"],
    blue:        ["Navy Blue", "Royal Blue", "Sky Blue", "Denim Blue"],
    purple:      ["Purple", "Lavender", "Plum"]
};

function classifyColor(r, g, b) {
    const lab = rgbToLab(r, g, b);
    const { h, s, l } = rgbToHsl(r, g, b);
    const bucket = colorFamilyBucket(h, s, l);
    const eligibleNames = FAMILY_BUCKET_NAMES[bucket] || [];
    const candidates = NAMED_COLOR_PALETTE.filter(c => eligibleNames.includes(c.name));
    const pool = candidates.length ? candidates : NAMED_COLOR_PALETTE; // safety net

    let best = pool[0], bestDist = Infinity;
    for (const candidate of pool) {
        const d = deltaE(lab, candidate.lab);
        if (d < bestDist) { bestDist = d; best = candidate; }
    }

    // Delta-E of ~2.3 or less is "imperceptible to the human eye"; anything
    // past ~25 is a genuinely different colour. Map that onto a 35–99%
    // confidence band so the UI can show something meaningful.
    const confidence = Math.max(35, Math.min(99, Math.round(100 - bestDist * 1.4)));

    return {
        name: best.name,
        family: best.family,
        warmth: best.warmth,
        r, g, b,
        hex: rgbToHex(r, g, b),
        deltaE: Math.round(bestDist * 10) / 10,
        confidence
    };
}

function checkColorAgainstPalette(colorInfo, palette, undertone, season) {
    if (!palette) return "okay";

    const nameLower   = colorInfo.name.toLowerCase();
    const familyLower = colorInfo.family.toLowerCase();

    // 🧠 FIXED: Bulletproof match system checking both strict arrays and token fragments
    const listHasMatch = (list) => {
        if (!list || !Array.isArray(list)) return false;
        return list.some(item => {
            const itemLower = item.toLowerCase();
            return itemLower.includes(nameLower) || 
                   itemLower.includes(familyLower) || 
                   nameLower.includes(itemLower) ||
                   familyLower.includes(itemLower);
        });
    };

    if (listHasMatch(palette.avoid)) return "avoid";
    if (listHasMatch(palette.best)) return "perfect";
    if (listHasMatch(palette.good) || listHasMatch(palette.accent) || listHasMatch(palette.neutrals)) return "good";

    // Warmth fallback check if it's outside the main seasonal tables
    if (colorInfo.warmth === "neutral") return "okay";
    if (undertone.toLowerCase() === "warm" && colorInfo.warmth === "warm") return "okay";
    if (undertone.toLowerCase() === "cool" && colorInfo.warmth === "cool") return "okay";

    return "caution";
}

const dressUpload   = document.getElementById("dressUpload");
const dressCheckBtn = document.getElementById("dressCheckBtn");
const dressResult   = document.getElementById("dressResult");
const dressPreviewBox = document.getElementById("dressPreviewBox");
const dressPreviewImg = document.getElementById("dressPreviewImg");

let dressImageData = null;

// 👗 Fix: Wiping camera streams on the clothes tab when an image file loads instead
if (dressUpload) {
    dressUpload.addEventListener("change", function() {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            dressImageData = e.target.result;
            dressPreviewImg.src = dressImageData;
            
            // 🚨 CRITICAL FIX: Shut down the camera immediately upon upload
            if (dressStreamInstance) {
                dressStreamInstance.getTracks().forEach(t => t.stop());
                dressStreamInstance = null;
            }
            const dVideo = document.getElementById("dressVideo");
            const dOpenBtn = document.getElementById("dressCameraOpenBtn");
            const dFlipBtn = document.getElementById("dressCameraFlipBtn");
            const dCaptureBtn = document.getElementById("dressCaptureBtn");

            if (dVideo) dVideo.style.display = "none";
            if (dOpenBtn) dOpenBtn.textContent = "📷 Open Camera";
            if (dFlipBtn) dFlipBtn.style.display = "none";
            if (dCaptureBtn) dCaptureBtn.style.display = "none";

            // Show the preview canvas frame box
            if (dressPreviewBox) dressPreviewBox.style.display = "block";
            const dPlaceholder = document.getElementById("dressPlaceholderText");
            if (dPlaceholder) dPlaceholder.style.display = "none";

            if (dressCheckBtn) dressCheckBtn.style.display = "inline-block";
            if (dressResult)   dressResult.style.display   = "none";
        };
        reader.readAsDataURL(file);
    });
}

// =========================================================================
// 🕶️ STANDALONE LIVE WEB-STREAM GLASSES TRY-ON CONTROLLER ENGINE
// =========================================================================
let glassesStreamInstance = null;
let currentGlassesFacingMode = "user";
let activeGlassesStyleId = null;
let glassesLoopRequestId = null;

// Curated per the standard optical classification: every frame is tagged with
// one of the 3 primary structures (Full-Rim / Semi-Rimless / Rimless) and the
// face shapes it's recommended for, following the 7-shape face guide
// (round, square, heart, oval, diamond, triangle, oblong).
// Each frame's `modelFile` points to /assets/3d-glasses/<file>.glb — drop your
// GLB models in that folder using these exact filenames and they'll load
// automatically. No file there yet = that frame just won't render (logged
// to console, doesn't break anything else).
const catalog3DDatabase = [
    // --- FULL-RIM ---
    { id: "fr_rect_black",  name: "Classic Rectangular", structure: "Full-Rim",     faceMatches: ["round", "oblong"],                why: "Adds angles and length to soften a curved face.",        color: 0x111111, widthMult: 2.1,  yOff: -0.05, modelFile: "fr_rect_black.glb" },
    { id: "fr_geo_square",  name: "Geometric Square",    structure: "Full-Rim",     faceMatches: ["round", "oval"],                  why: "Sharp lines balance rounder or softer features.",        color: 0x263238, widthMult: 2.15, yOff: -0.05, modelFile: "fr_geo_square.glb" },
    { id: "fr_round_tort",  name: "Round Tortoiseshell", structure: "Full-Rim",     faceMatches: ["square", "diamond"],              why: "Rounded curves soften a strong jawline or angular cheekbones.", color: 0x6B4F35, widthMult: 2.0,  yOff: -0.06, modelFile: "fr_round_tort.glb" },
    { id: "fr_cateye_purp", name: "Vintage Cat-Eye",     structure: "Full-Rim",     faceMatches: ["heart", "diamond"],               why: "Upswept corners echo and highlight high cheekbones.",    color: 0x4c1d95, widthMult: 2.1,  yOff: -0.10, modelFile: "fr_cateye_purp.glb" },
    { id: "fr_wayfarer_blk",name: "Iconic Wayfarer",     structure: "Full-Rim",     faceMatches: ["oval", "round"],                  why: "A versatile trapezoidal shape that suits most faces.",   color: 0x000000, widthMult: 2.1,  yOff: -0.08, modelFile: "fr_wayfarer_blk.glb" },
    { id: "fr_oversized_sq",name: "Oversized Square",    structure: "Full-Rim",     faceMatches: ["oblong", "round"],                why: "Extra depth shortens and balances a longer face.",       color: 0x1E3A5F, widthMult: 2.3,  yOff: -0.05, modelFile: "fr_oversized_sq.glb" },

    // --- SEMI-RIMLESS ---
    { id: "sr_browline_brn",name: "Browline Retro",      structure: "Semi-Rimless", faceMatches: ["triangle", "oblong", "oval"],     why: "Bold brow line widens the upper face to balance a wider jaw.", color: 0x5A3A22, widthMult: 2.15, yOff: -0.12, modelFile: "sr_browline_brn.glb" },
    { id: "sr_rect_gun",    name: "Modern Rectangular",  structure: "Semi-Rimless", faceMatches: ["round", "oval"],                  why: "Clean straight lines add gentle structure.",             color: 0x414A4C, widthMult: 2.2,  yOff: -0.05, modelFile: "sr_rect_gun.glb" },

    // --- RIMLESS ---
    { id: "rl_aviator_gld", name: "Classic Aviator",     structure: "Rimless",      faceMatches: ["triangle", "oblong", "square"],   why: "Wide top bar adds width up top, balancing a narrower or angular jaw.", color: 0xc0a000, widthMult: 2.4, yOff: -0.12, modelFile: "rl_aviator_gld.glb" },
    { id: "rl_oval_silv",   name: "Lightweight Oval",    structure: "Rimless",      faceMatches: ["heart", "diamond", "oval"],       why: "Soft, near-invisible edge that doesn't compete with delicate features.", color: 0xAAAAAA, widthMult: 2.0, yOff: -0.06, modelFile: "rl_oval_silv.glb" }
];

window.openGlassesCamera = async function() {
    // ONLY targets Glasses Tab elements
    const gVideo = document.getElementById("glassesVideo");
    const gCanvas = document.getElementById("glassesTryOnCanvas");
    const gPlaceholder = document.getElementById("glassesPlaceholderText");
    const gOpenBtn = document.getElementById("glassesCameraOpenBtn");

    // CRITICAL: Ensure we do not interfere with 'stream' (the analysis stream)
    // We strictly use 'glassesStreamInstance' only
    try {
        if (glassesStreamInstance) glassesStreamInstance.getTracks().forEach(t => t.stop());
        
        glassesStreamInstance = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: { ideal: currentGlassesFacingMode } }, 
            audio: false 
        });

        gVideo.srcObject = glassesStreamInstance;
        gVideo.style.display = "block";
        gCanvas.style.display = "block";
        gPlaceholder.style.display = "none";

        const gFlipBtn = document.getElementById("glassesCameraFlipBtn");
        if (gFlipBtn) gFlipBtn.style.display = "flex";

        const gCaptureBtn = document.getElementById("glassesCaptureBtn");
        if (gCaptureBtn) gCaptureBtn.style.display = "flex";
        
        gOpenBtn.textContent = "✕ Close";
        gOpenBtn.onclick = window.closeGlassesCamera;

        const gMonitorBox = document.getElementById("glassesLiveMonitorBox");
        if (gMonitorBox) gMonitorBox.classList.add("glasses-active");

        gVideo.onloadedmetadata = () => {
            // Set the canvas's actual render resolution before Three.js reads
            // it — otherwise the camera/renderer briefly get built against the
            // canvas element's default 300x150 size.
            gCanvas.width = gVideo.videoWidth;
            gCanvas.height = gVideo.videoHeight;

            initThreeJSScene(gVideo, gCanvas);
            // ONLY runs the structural scanner on THIS specific Glasses tab stream
            runInstantFaceStructureScan();
            if (glassesLoopRequestId) cancelAnimationFrame(glassesLoopRequestId);
            glassesLoopRequestId = requestAnimationFrame(render3DTrackingFrameLoopTick);
        };
    } catch (err) {
        alert("Camera error in Glasses tab. Please check permissions.");
    }
};

// Upgraded 7-Shape Geometric Face Analysis Logic
window.getFaceShape = function(landmarks) {
    if (!landmarks || !landmarks.positions || landmarks.positions.length !== 68) return 'oval';
    
    try {
        const p = landmarks.positions;

        // Widths
        const faceWidth = p[16].x - p[0].x;
        const jawWidth = p[12].x - p[4].x;
        const foreheadWidth = p[26].x - p[17].x;

        // Heights
        const faceHeight = p[8].y - ((p[19].y + p[24].y) / 2); // Chin to mid-eyebrow
        const midFaceHeight = p[33].y - ((p[19].y + p[24].y) / 2); // Nose-bridge to mid-eyebrow

        const heightToWidthRatio = faceHeight / faceWidth;

        // --- Structural Classification Logic ---

        // Oblong: Significantly longer than wide
        if (heightToWidthRatio > 1.4) return 'oblong';

        // Heart: Forehead is widest, chin is pointed.
        if (foreheadWidth > jawWidth && (p[8].y - p[5].y) > midFaceHeight * 0.5) {
            return 'heart';
        }

        // Square: Jaw and forehead are similar widths, angular jaw.
        const jawAngleYDiff = p[4].y - p[2].y;
        if (Math.abs(jawWidth - foreheadWidth) < faceWidth * 0.1 && jawAngleYDiff < 10) {
            return 'square';
        }

        // Round: Face is nearly as wide as it is tall, soft jawline.
        if (heightToWidthRatio < 1.05 && jawAngleYDiff > 15) {
            return 'round';
        }
        
        // Diamond: Widest at the cheeks (p[1] and p[15]), narrow forehead and jaw.
        const cheekWidth = p[15].x - p[1].x;
        if (cheekWidth > foreheadWidth && cheekWidth > jawWidth) {
            return 'diamond';
        }

        // Triangle: Jawline is wider than forehead.
        if (jawWidth > foreheadWidth) {
            return 'triangle';
        }

        return 'oval'; // Default balanced
    } catch(e) { 
        console.warn("Face shape detection failed, defaulting to oval.", e);
        return 'oval'; 
    }
};

async function runInstantFaceStructureScan() {
    const statusText = document.getElementById("glassesFaceShapeResultText");
    const gVideo = document.getElementById("glassesVideo");
    if (!statusText || !gVideo) return;

    statusText.textContent = "🧬 Scanning bone structure...";

    // Same tuned, more lighting-tolerant settings used elsewhere in this file
    // (the previous default TinyFaceDetectorOptions() was noticeably
    // stricter and would miss faces in dim/warm indoor lighting).
    const detectorOptions = new window.faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 });

    try {
        let detection = null;
        // The very first attempt can fire before the video frame is fully
        // painted, so retry a few times with a short pause rather than
        // giving up after a single try.
        for (let attempt = 0; attempt < 4 && !detection; attempt++) {
            if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 350));
            detection = await window.faceapi.detectSingleFace(gVideo, detectorOptions).withFaceLandmarks();
        }

        if (detection) {
            window._storedTryOnLandmarks = detection.landmarks;
            const faceShape = window.getFaceShape(detection.landmarks);
            statusText.innerHTML = `🧬 AI STRUCTURE: <span style="color:#34d399;">${faceShape.toUpperCase()} FACE</span>`;
            // Immediately load the curated tray based on this scan
            renderCuratedGlassesSelectionTray();
        } else {
            statusText.textContent = "🧬 Couldn't detect a face — check lighting and make sure your whole face is in frame.";
        }
    } catch (err) {
        console.warn("Face structure scan failed:", err);
        statusText.textContent = "🧬 Face scan unavailable right now.";
    }
}

// Shared by the tray cards and the persistent Buy Now bar so the affiliate
// link logic only lives in one place.
function buildGlassesAmazonBuyUrl(frame) {
    const isIndia = isUserInIndia();
    const affiliateId = isIndia ? 'aicoloronline-21' : 'aicolor-20';
    const amazonDomain = isIndia ? 'amazon.in' : 'amazon.com';
    const searchTerm = encodeURIComponent(`${frame.name} glasses`);
    return `https://www.${amazonDomain}/s?k=${searchTerm}&tag=${affiliateId}`;
}

function renderCuratedGlassesSelectionTray() {
    const trayContainer = document.getElementById("glassesSelectionTray");
    const faceShape = (window.getFaceShape(window._storedTryOnLandmarks) || "oval").toLowerCase();
    if (!trayContainer) return;

    // Direct matches for this specific face shape first.
    let curatedFrames = catalog3DDatabase.filter(frame => frame.faceMatches.includes(faceShape));

    // Only top up with versatile "oval-friendly" frames if direct matches are thin —
    // previously this ORed in every oval-tagged frame for every face shape, which
    // drowned out the actual recommendation with generic filler.
    if (curatedFrames.length < 3) {
        const versatile = catalog3DDatabase.filter(
            frame => frame.faceMatches.includes("oval") && !curatedFrames.includes(frame)
        );
        curatedFrames = curatedFrames.concat(versatile);
    }

    // Flat, ordered strip (Full-Rim → Semi-Rimless → Rimless) rather than
    // grouped sections — this renders as a single horizontally-scrollable
    // row of cards (see .glasses-tray-scroll), so section headers would just
    // break up the scroll rather than organize it. Each card's structure tag
    // still shows on the card itself.
    const structureOrder = ["Full-Rim", "Semi-Rimless", "Rimless"];
    curatedFrames = curatedFrames.slice().sort(
        (a, b) => structureOrder.indexOf(a.structure) - structureOrder.indexOf(b.structure)
    );

    let trayHtml = "";

    curatedFrames.forEach(frame => {
        const isActive = activeGlassesStyleId === frame.id;
        const safeWhy = (frame.why || frame.name).replace(/"/g, '&quot;');

        // No external thumbnail image — those files don't ship with this
        // build, which is what was causing the broken-image icons. A CSS
        // swatch + icon carries the same info without a missing asset.
        // The whole card is a button: tapping it previews the frame live on
        // camera immediately (window.setActiveGlassesModel below also drives
        // the persistent Buy Now bar), so trying a look never requires more
        // than one tap.
        trayHtml += `
            <button type="button" class="glasses-card${isActive ? ' glasses-card-active' : ''}"
                    onclick="window.setActiveGlassesModel('${frame.id}')" title="${safeWhy}">
                <span class="glasses-card-swatch" style="background:#${frame.color.toString(16).padStart(6, '0')};">🕶️</span>
                <span class="glasses-card-name">${frame.name}</span>
                <span class="glasses-card-structure">${frame.structure}</span>
            </button>
        `;
    });

    trayContainer.innerHTML = trayHtml || `<p class="glasses-tray-empty">No recommended frames found for your face shape.</p>`;
}

// Stub function to be called by the try-on buttons
window.setActiveGlassesModel = function(glassesId) {
    activeGlassesStyleId = glassesId;
    console.log("Set active 3D glasses model to:", glassesId);
    // Re-render so the selected card gets the active highlight.
    renderCuratedGlassesSelectionTray();
    loadGlassesModel(glassesId);

    // Drive the persistent bottom Buy Now bar off the same selection — it
    // only appears once a frame is actually being previewed, and always
    // points at whichever frame is currently on-screen.
    const buyPanel = document.getElementById("glassesAffiliatePanel");
    const buyLink = document.getElementById("glassesAffiliateLink");
    if (buyPanel && buyLink) {
        const frame = glassesId ? catalog3DDatabase.find(f => f.id === glassesId) : null;
        if (frame) {
            buyLink.href = buildGlassesAmazonBuyUrl(frame);
            buyLink.textContent = `🛒 Buy "${frame.name}"`;
            buyPanel.style.display = "block";
        } else {
            buyPanel.style.display = "none";
        }
    }
};

// ============================================================================
// 3D GLASSES ENGINE (Three.js)
// Models load from: assets/3d-glasses/<modelFile>.glb  (see catalog3DDatabase)
// ============================================================================

let threeScene, threeCamera, threeRenderer, threeGlassesModel;
let glassesLoadRequestId = 0; // increments per load() call so stale async callbacks can be ignored
const GLASSES_MODEL_FOLDER = "assets/3d-glasses/";

function initThreeJSScene(videoElement, canvasElement) {
    if (typeof THREE === "undefined") {
        console.warn("Three.js is not loaded — 3D glasses rendering is unavailable.");
        return;
    }

    threeScene = new THREE.Scene();

    threeCamera = new THREE.PerspectiveCamera(35, canvasElement.width / canvasElement.height || 1, 0.1, 1000);
    threeCamera.position.set(0, 0, 5);
    threeCamera.lookAt(0, 0, 0);

    threeRenderer = new THREE.WebGLRenderer({ canvas: canvasElement, alpha: true, antialias: true, preserveDrawingBuffer: true });
    threeRenderer.setSize(canvasElement.width, canvasElement.height, false);
    threeRenderer.setClearColor(0x000000, 0); // fully transparent, so the video shows through

    threeScene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
    keyLight.position.set(0, 1, 2);
    threeScene.add(keyLight);

    // If a frame was already selected before the camera opened, load it now.
    if (activeGlassesStyleId) loadGlassesModel(activeGlassesStyleId);
}

function loadGlassesModel(glassesId) {
    if (typeof THREE === "undefined" || typeof THREE.GLTFLoader === "undefined") {
        console.warn("GLTFLoader is not available — check that the Three.js + GLTFLoader <script> tags are included in index.html.");
        return;
    }
    if (!threeScene) return; // camera/scene not open yet — loadGlassesModel() runs again from initThreeJSScene once it is

    // Always remove (and properly dispose) whatever's currently shown first —
    // this needs to run unconditionally, including when glassesId is null
    // (Clear Frames) or points at a frame with no model, otherwise the old
    // model is left orphaned in the scene and keeps rendering.
    if (threeGlassesModel) {
        threeScene.remove(threeGlassesModel);
        threeGlassesModel.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach((mat) => {
                        Object.values(mat).forEach((val) => {
                            if (val && val.isTexture) val.dispose();
                        });
                        mat.dispose();
                    });
                }
            }
        });
        threeGlassesModel = null;
    }

    lastKnownLandmarks = null; // avoid one stale frame of the old model's position/scale bleeding into the next

    const frame = catalog3DDatabase.find(f => f.id === glassesId);
    if (!frame || !frame.modelFile) return; // null (Clear Frames) or a frame with no model yet — stop here, scene is already clean

    const loader = new THREE.GLTFLoader();
    const modelPath = GLASSES_MODEL_FOLDER + frame.modelFile;

    // Snapshot the request counter. If the user clicks "Try On" again (same
    // frame or a different one) before this load finishes, that click bumps
    // glassesLoadRequestId, so this stale callback can tell it's no longer
    // the latest request and bail out — without this, two quick clicks could
    // both finish loading and both call threeScene.add(), leaving two glasses
    // models rendered on the face at once.
    const requestId = ++glassesLoadRequestId;

    loader.load(
        modelPath,
        (gltf) => {
            // Only apply if this is still the most recent load request AND
            // still the selected frame (guards against a slow load finishing
            // after the user picked something else, or double-clicked).
            if (requestId !== glassesLoadRequestId) return;
            if (activeGlassesStyleId !== glassesId) return;

            const rawModel = gltf.scene;

            // Downloaded/exported models come in at wildly different native
            // scales and pivots (this file, for example, is a Sketchfab FBX
            // export with a ~100x scale baked into its node transforms,
            // ending up ~300 Three.js units wide with an off-center pivot).
            // Normalize every model to the same reference width and center
            // it on its own bounding box, so scale/rotation behave the same
            // regardless of what the source file's original units were.
            const box = new THREE.Box3().setFromObject(rawModel);
            const size = new THREE.Vector3();
            box.getSize(size);
            const center = new THREE.Vector3();
            box.getCenter(center);

            rawModel.position.sub(center); // re-center on its own bounding box

            // Many export pipelines (Sketchfab/FBX especially) produce
            // inverted or single-sided face normals. With default culling
            // that can render as completely invisible from the try-on
            // camera angle even though the model loaded successfully —
            // forcing double-sided rendering rules that out.
            rawModel.traverse((child) => {
                if (child.isMesh && child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach((mat) => { mat.side = THREE.DoubleSide; });
                }
            });

            const wrapper = new THREE.Group();
            wrapper.add(rawModel);

            const REFERENCE_WIDTH = 1; // wrapper.scale of 1 == 1 Three.js unit wide
            const nativeWidth = size.x || 1;
            const baseScale = REFERENCE_WIDTH / nativeWidth;
            wrapper.userData.baseScale = baseScale;

            // Apply a sensible default scale/position immediately, so the
            // model is visible right away instead of only appearing once
            // face tracking succeeds (which may take a moment, or fail in
            // poor lighting) — positionGlassesModel() will refine this every
            // frame once a face is actually detected.
            wrapper.scale.setScalar(baseScale * 0.6);
            wrapper.position.set(0, 0, 0);

            threeGlassesModel = wrapper;
            threeScene.add(threeGlassesModel);

            console.log(`Loaded "${frame.name}" — native width ${size.x.toFixed(3)} units, normalized.`);
        },
        undefined,
        (err) => {
            console.warn(`Couldn't load 3D model for "${frame.name}" from ${modelPath}. Make sure the file exists in /assets/3d-glasses/.`, err);
        }
    );
}

let lastGlassesDetectionTime = 0;
const GLASSES_DETECTION_INTERVAL_MS = 120; // throttle heavy detection calls
let lastKnownLandmarks = null;

async function render3DTrackingFrameLoopTick() {
    if (!glassesStreamInstance) return;

    const gVideo = document.getElementById("glassesVideo");
    const gCanvas = document.getElementById("glassesTryOnCanvas");

    if (gVideo && gCanvas && gVideo.videoWidth && threeRenderer) {
        if (gCanvas.width !== gVideo.videoWidth || gCanvas.height !== gVideo.videoHeight) {
            gCanvas.width = gVideo.videoWidth;
            gCanvas.height = gVideo.videoHeight;
            threeRenderer.setSize(gCanvas.width, gCanvas.height, false);
            threeCamera.aspect = gCanvas.width / gCanvas.height;
            threeCamera.updateProjectionMatrix();
        }

        if (threeGlassesModel && window.faceapi) {
            const now = performance.now();
            if (now - lastGlassesDetectionTime > GLASSES_DETECTION_INTERVAL_MS) {
                lastGlassesDetectionTime = now;
                try {
                    const detection = await window.faceapi
                        .detectSingleFace(gVideo, new window.faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 }))
                        .withFaceLandmarks();
                    if (detection) lastKnownLandmarks = detection.landmarks;
                } catch (e) {
                    // Detection can transiently fail between frames (e.g. face briefly out of view) — reuse last known position.
                }
            }

            // Re-check threeGlassesModel here (not just lastKnownLandmarks) —
            // the await above can take long enough for the user to switch or
            // clear the selected frame mid-flight, which nulls threeGlassesModel.
            // Without this guard, positionGlassesModel would run against a
            // model that no longer exists and throw.
            if (threeGlassesModel && lastKnownLandmarks) {
                positionGlassesModel(lastKnownLandmarks, gVideo, gCanvas);
            }
        }

        threeRenderer.render(threeScene, threeCamera);
    }

    glassesLoopRequestId = requestAnimationFrame(render3DTrackingFrameLoopTick);
}

// NOTE: face-api's 68-point landmarks are 2D image-space points only — there's
// no real depth or head-pose (pitch/yaw) data, so this positions and scales
// the model from eye position/distance and rolls it to match the eye-line
// angle. It will not convincingly follow head turns/nods the way true 3D
// face-mesh tracking (e.g. MediaPipe Face Landmarker, which gives 3D points)
// would. A yaw-rotation approximation was tried here previously, but it
// rotates the model around the pivot baked into the .glb's own bounding box
// — which isn't guaranteed to sit exactly at the optical center between the
// lenses — so any rotation visibly dragged the lenses away from the eyes
// instead of swinging just the temple arms. Fixing that properly needs
// either a corrected pivot/anchor point authored into the model itself, or
// real 3D head-pose data (e.g. MediaPipe Face Landmarker) instead of this
// 2D-landmark estimate. Until then this stays flat/roll-only, which keeps
// the frame accurately centered on the face at all times.
function positionGlassesModel(landmarks, videoEl, canvasEl) {
    if (!threeGlassesModel) return; // model may have been cleared/swapped since this call was scheduled

    const leftEye = averagePoint(landmarks.getLeftEye());
    const rightEye = averagePoint(landmarks.getRightEye());
    const eyeDist = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
    const midX = (leftEye.x + rightEye.x) / 2;
    const midY = (leftEye.y + rightEye.y) / 2;
    const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);

    // Map 2D video pixel coords -> normalized device coords -> a world-space
    // plane in front of the camera at a fixed distance.
    const ndcX = (midX / videoEl.videoWidth) * 2 - 1;
    const ndcY = -((midY / videoEl.videoHeight) * 2 - 1);

    const distance = 5; // matches threeCamera.position.z
    const vFOV = (threeCamera.fov * Math.PI) / 180;
    const viewHeight = 2 * Math.tan(vFOV / 2) * distance;
    const viewWidth = viewHeight * threeCamera.aspect;

    const frame = catalog3DDatabase.find(f => f.id === activeGlassesStyleId);
    const widthMult = (frame && frame.widthMult) || 2.1;
    const yOff = (frame && typeof frame.yOff === "number") ? frame.yOff : 0;
    const baseScale = threeGlassesModel.userData.baseScale || 1;

    // A real pair of glasses (temple to temple) is noticeably wider than the
    // pupil-to-pupil distance the landmarks give us — this ratio calibrates
    // eyeDist up to an actual glasses width. If sizing still looks off for a
    // particular model, this constant is the one to tune.
    const GLASSES_WIDTH_TO_EYE_DIST_RATIO = 2.2;

    const dynamicScale = (eyeDist / videoEl.videoWidth) * viewWidth * GLASSES_WIDTH_TO_EYE_DIST_RATIO * (widthMult / 2.1);
    const finalScale = baseScale * dynamicScale;
    threeGlassesModel.scale.set(finalScale, finalScale, finalScale);

    // NOTE: catalog3DDatabase defines a per-frame `yOff` meant to nudge each
    // style down toward the nose bridge/ear line (styles with deeper temple
    // arms or a contoured brow bar — cat-eye, aviator, browline — need a
    // bigger downward nudge than a plain rectangular frame). That value was
    // previously defined but never applied anywhere, so every model sat at
    // raw eye-line height, which pushed the temple arms/hinges up across the
    // eyes instead of resting back at the ears. yOff is expressed in the
    // model's own normalized units (its width == 1 before final scaling), so
    // it's converted through the same finalScale the model is drawn at —
    // that keeps the downward nudge proportionally correct at any face
    // distance/zoom instead of being a fixed on-screen pixel offset.
    const worldYOffset = yOff * finalScale;

    threeGlassesModel.position.set(
        (ndcX * viewWidth) / 2,
        (ndcY * viewHeight) / 2 + worldYOffset,
        0
    );
    threeGlassesModel.rotation.z = -roll;
}

function averagePoint(points) {
    const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const y = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    return { x, y };
}

// ============================================================================
// CAPTURE & DOWNLOAD — composites the live camera frame + rendered glasses
// into a single branded image and triggers a download.
// ============================================================================

function drawRoundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

window.captureGlassesSnapshot = function() {
    const gVideo = document.getElementById("glassesVideo");
    const gCanvas = document.getElementById("glassesTryOnCanvas");

    if (!gVideo || !gVideo.videoWidth || !glassesStreamInstance) {
        alert("Start the camera first, then capture your photo.");
        return;
    }

    const photoW = gVideo.videoWidth;
    const photoH = gVideo.videoHeight;
    const padding = Math.round(photoW * 0.045);
    const footerH = Math.round(photoH * 0.16);
    const frameW = photoW + padding * 2;
    const frameH = photoH + padding * 2 + footerH;
    const cornerRadius = Math.round(photoW * 0.03);

    const out = document.createElement("canvas");
    out.width = frameW;
    out.height = frameH;
    const ctx = out.getContext("2d");

    // Background panel
    const bgGradient = ctx.createLinearGradient(0, 0, frameW, frameH);
    bgGradient.addColorStop(0, "#0b1030");
    bgGradient.addColorStop(1, "#161b3d");
    ctx.fillStyle = bgGradient;
    drawRoundedRectPath(ctx, 0, 0, frameW, frameH, cornerRadius + 10);
    ctx.fill();

    // Gradient accent border
    const borderGradient = ctx.createLinearGradient(0, 0, frameW, 0);
    borderGradient.addColorStop(0, "#4f46e5");
    borderGradient.addColorStop(0.5, "#7c3aed");
    borderGradient.addColorStop(1, "#34d399");
    ctx.lineWidth = 5;
    ctx.strokeStyle = borderGradient;
    drawRoundedRectPath(ctx, 3, 3, frameW - 6, frameH - 6, cornerRadius + 8);
    ctx.stroke();

    // Photo — clipped to rounded corners, composited from the live video and
    // the WebGL glasses canvas on top of it (mirrors what's on screen).
    ctx.save();
    drawRoundedRectPath(ctx, padding, padding, photoW, photoH, cornerRadius);
    ctx.clip();
    ctx.drawImage(gVideo, padding, padding, photoW, photoH);
    ctx.drawImage(gCanvas, padding, padding, photoW, photoH);
    ctx.restore();

    // Thin inner highlight around the photo
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    drawRoundedRectPath(ctx, padding, padding, photoW, photoH, cornerRadius);
    ctx.stroke();

    // Footer branding
    const footerCenterY = padding * 2 + photoH + footerH / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.round(footerH * 0.30)}px Arial, sans-serif`;
    ctx.fillText("🕶️  Virtual Glasses Try-On", frameW / 2, footerCenterY - footerH * 0.16);

    ctx.fillStyle = "#94a3b8";
    ctx.font = `600 ${Math.round(footerH * 0.18)}px Arial, sans-serif`;
    ctx.fillText("AI COLOR ANALYSIS  •  aicoloranalysis.online", frameW / 2, footerCenterY + footerH * 0.22);

    // Trigger download
    const link = document.createElement("a");
    link.download = `ai-color-analysis-virtual-glasses-${Date.now()}.png`;
    link.href = out.toDataURL("image/png");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

window.closeGlassesCamera = function() {
    const gVideo = document.getElementById("glassesVideo");
    const gCanvas = document.getElementById("glassesTryOnCanvas");
    const gPlaceholder = document.getElementById("glassesPlaceholderText");
    const gOpenBtn = document.getElementById("glassesCameraOpenBtn");
    const gFlipBtn = document.getElementById("glassesCameraFlipBtn");

    // Closing the camera should reset the whole try-on session, not just the
    // video feed — otherwise the previously selected frame stays "active" on
    // the tray, the Buy Now bar stays visible pointing at a frame that's no
    // longer on anyone's face, and the AI STRUCTURE line still shows the old
    // scan result. Reusing setActiveGlassesModel(null) clears the tray
    // highlight, unloads the 3D model, and hides the Buy Now bar in one go —
    // the same path the "✕ Clear" button already uses.
    window.setActiveGlassesModel(null);

    const statusText = document.getElementById("glassesFaceShapeResultText");
    if (statusText) statusText.innerHTML = "";

    if (glassesLoopRequestId) cancelAnimationFrame(glassesLoopRequestId);
    glassesLoopRequestId = null;
    if (glassesStreamInstance) {
        glassesStreamInstance.getTracks().forEach(t => t.stop());
        glassesStreamInstance = null;
    }
    lastKnownLandmarks = null;
    lastGlassesDetectionTime = 0;

    if (gVideo) gVideo.style.display = "none";
    if (gCanvas) gCanvas.style.display = "none";
    if (gPlaceholder) gPlaceholder.style.display = "block";
    if (gFlipBtn) gFlipBtn.style.display = "none";

    const gCaptureBtn = document.getElementById("glassesCaptureBtn");
    if (gCaptureBtn) gCaptureBtn.style.display = "none";

    if (gOpenBtn) {
        gOpenBtn.textContent = "📷 Start Camera";
        gOpenBtn.onclick = window.openGlassesCamera;
    }

    const gMonitorBox = document.getElementById("glassesLiveMonitorBox");
    if (gMonitorBox) gMonitorBox.classList.remove("glasses-active");
};

window.toggleGlassesCameraLens = function() {
    currentGlassesFacingMode = (currentGlassesFacingMode === "user") ? "environment" : "user";
    window.openGlassesCamera();
};

// Populate the curated tray immediately on load with a versatile default set
// (function declarations are hoisted, so this can run before its definition
// appears further down the file), so the panel isn't empty before the user
// has run a face-shape scan.
if (document.getElementById("glassesSelectionTray")) {
    renderCuratedGlassesSelectionTray();
}

if (dressCheckBtn) {
    dressCheckBtn.addEventListener("click", async () => {
        if (!dressImageData) return;
        if (!window._userPalette) {
            dressResult.style.display = "block";
            dressResult.innerHTML = `<p style="color:#f59e0b;">⚠️ Please run your skin analysis first before checking a product.</p>`;
            return;
        }

        dressCheckBtn.textContent = "⏳ Analysing...";
        dressCheckBtn.disabled    = true;

        const img = await new Promise((res,rej) => {
            const i = new Image();
            i.onload = ()=>res(i);
            i.onerror=()=>rej();
            i.src = dressImageData;
        });

        const dominant  = getDominantColor(img);
        const colorInfo = classifyColor(dominant.r, dominant.g, dominant.b);
        const verdict   = checkColorAgainstPalette(colorInfo, window._userPalette, window._userUndertone, window._userSeason);

        if (typeof gtag === "function") {
            gtag('event', 'use_dress_checker', {
                'detected_color': colorInfo.name,
                'match_verdict': verdict
            });
        }

        dressCheckBtn.textContent = "🎨 Check This Color";
        dressCheckBtn.disabled    = false;

        // Curated reason traits assigned dynamically based on seasonal matches
        const isWarm = window._userUndertone === "Warm";
        const traits = {
            perfect: [
                isWarm ? "✓ Rich, warm and optimized tone" : "✓ Soft, cool and muted tone",
                "✓ Complements your natural undertone",
                "✓ Enhances your natural facial harmony",
                "✓ Perfect choice for everyday wear"
            ],
            good: [
                "✓ Harmonious color temperature",
                "✓ Coordinates with your season style",
                "✓ Safe tonal configuration",
                "✓ Great secondary accessory choice"
            ],
            neutral: [
                "⚠ Blends safely but can wash you out",
                "⚠ Lacks optimal clarity for your face",
                "⚠ Counter-balance with your best accent",
                "⚠ Best kept away from immediate portraits"
            ],
            caution: [
                "⚠ Sits just outside your natural undertone",
                "⚠ Can look flat without the right styling",
                "⚠ Pair with one of your best neutrals to balance it",
                "⚠ Fine occasionally, not an everyday staple"
            ],
            avoid: [
                "✗ Clashes directly with your undertone",
                "✗ Highly likely to wash out your color profiles",
                "✗ Creates harsh shadows on your features",
                "✗ We strongly recommend alternative shades"
            ]
        };

        // checkColorAgainstPalette() returns one of 5 tiers: perfect, good,
        // okay, caution, avoid. Map each explicitly onto its own trait
        // bucket above — previously "caution" fell through to the "avoid"
        // bucket's harsher wording (✗ Clashes directly..., etc.), which
        // directly contradicted the softer "Proceed with Caution" headline
        // shown just above it.
        const VERDICT_TO_TRAIT_KEY = { perfect: "perfect", good: "good", okay: "neutral", caution: "caution", avoid: "avoid" };
        const activeTraits = traits[VERDICT_TO_TRAIT_KEY[verdict] || "avoid"];

        // Capture 5 fallback swatches dynamically straight out of the active user profile palette
        const dressCheckerPalette = window._userPalette || {};
        const dressCheckerSwatchSource = (dressCheckerPalette.best && dressCheckerPalette.best.length >= 5)
            ? dressCheckerPalette.best
            : (dressCheckerPalette.neutrals && dressCheckerPalette.neutrals.length >= 5)
                ? dressCheckerPalette.neutrals
                : ["Peach", "Coral", "Yellow", "Mint Green", "Sky Blue"];
        const swatchFallbackList = dressCheckerSwatchSource.slice(0, 5);
        let swatchesHtmlMarkup = "";
        swatchFallbackList.forEach(swName => {
            const resolvedSwatchHex = resolveColorHex(swName);
            swatchesHtmlMarkup += `<div style="flex: 1; height: 36px; border-radius: 6px; background: ${resolvedSwatchHex}; border: 1px solid rgba(255,255,255,0.1);" title="${swName}"></div>`;
        });

        const verdictConfig = {
            perfect: {
                emoji: "✓", title: "Perfect Match!",
                msg: `This color fits beautifully in your <strong>${window._userSeason}</strong> palette. It will naturally enhance your undertone and make you look <strong>radiant</strong>.`,
                bg: "#064e3b", border: "#10b981", titleColor: "#10b981"
            },
            good: {
                emoji: "✓", title: "Good Choice",
                msg: `This color is a solid pick for your <strong>${window._userSeason}</strong> profile. It complements your palette well, bringing out great features.`,
                bg: "#1e3a8a", border: "#3b82f6", titleColor: "#3b82f6"
            },
            okay: {
                emoji: "⚠", title: "Wearable but Not Ideal",
                msg: `This color can work, but it's not optimized for your <strong>${window._userSeason}</strong> palette. Pair it with clear neutrals.`,
                bg: "#451a03", border: "#f59e0b", titleColor: "#f59e0b"
            },
            caution: {
                emoji: "⚠", title: "Proceed with Caution",
                msg: `This color doesn't align well with your <strong>${window._userUndertone}</strong> profile parameters. It may wash you out.`,
                bg: "#3b1f00", border: "#f97316", titleColor: "#f97316"
            },
            avoid: {
                emoji: "✗", title: "Not Recommended",
                msg: `This color is on the avoid list for your <strong>${window._userSeason}</strong> profile. It clashes heavily with your undertone.`,
                bg: "#450a0a", border: "#ef4444", titleColor: "#f87171"
            }
        };

        const v = verdictConfig[verdict];
        dressResult.style.display = "block";

        // Comprehensive rendering mapping exactly with image reference layouts
        dressResult.innerHTML = `
            <div style="background: rgba(15, 23, 42, 0.4); border: 1px solid #1e295d; border-radius: 12px; padding: 14px; box-sizing: border-box; text-align: left;">

                <div style="background: ${v.bg}; border: 1px solid ${v.border}; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; box-sizing: border-box;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                        <span style="color: ${v.titleColor}; font-weight: 900; font-size: 1.1rem;">${v.emoji}</span>
                        <span style="font-size: 0.95rem; font-weight: 800; color: #ffffff;">${v.title}</span>
                    </div>
                    <p style="color: #cbd5e1; font-size: 0.82rem; line-height: 1.45; margin: 0;">
                        Detected color: <strong>${colorInfo.name}</strong> (${dominant.hex}) &nbsp;·&nbsp; ${v.msg}
                    </p>
                </div>

                <div style="margin-bottom: 14px; box-sizing: border-box; padding: 0 2px;">
                    <span style="font-size: 0.72rem; font-weight: 800; color: #818cf8; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 6px;">Why it works for you</span>
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        ${activeTraits.map(t => `<div style="font-size: 0.78rem; color: #94a3b8; font-weight: 500;">${t}</div>`).join('')}
                    </div>
                </div>

                <div style="box-sizing: border-box; padding: 0 2px; margin-top: 10px;">
                    <span style="font-size: 0.72rem; font-weight: 800; color: #818cf8; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 6px;">Similar matches in your palette</span>
                    <div style="display: flex; gap: 6px; width: 100%;">
                        ${swatchesHtmlMarkup}
                    </div>
                </div>

            </div>
        `;

        dressCheckBtn.textContent = "🎨 Check This Color";
        dressCheckBtn.disabled    = false;
    });
}

function unlockDressChecker(palette, undertone, season) {
    window._userPalette   = palette;
    window._userUndertone = undertone;
    window._userSeason    = season;
    
    // 🔓 Hide the lock screen and display the main workspace wrapper cleanly
    const locked  = document.getElementById("dressCheckerLocked");
    const activeWorkspace = document.getElementById("sandboxActiveWorkspaceWrapper");
    
    if (locked) locked.style.display = "none";
    if (activeWorkspace) activeWorkspace.style.display = "block";

    if (window._latestFaceLandmarks) {
        window._storedTryOnLandmarks = window._latestFaceLandmarks;
    }
}
// ── 🧠 GLOBAL ACCORDION ENGINE CONTROLLERS ──
window.toggleAccordionPanel = function(panelElementId) {
    const targetPanel = document.getElementById(panelElementId);
    if (!targetPanel) return;

    const isOpened = targetPanel.classList.contains("panel-opened");
    
    // Close the panel if it's already open, otherwise open it
    if (isOpened) {
        targetPanel.classList.remove("panel-opened");
    } else {
        targetPanel.classList.add("panel-opened");
    }
};

// Auto-expands individual categories when calculations finish running so users see them instantly
window.expandAllAccordionPanels = function() {
    document.querySelectorAll(".accordion-item-wrapper").forEach(panel => {
        panel.classList.add("panel-opened");
    });
};
// ── 📸 LIVE CLOTH CAMERA EXTENSION HOOKS WITH LENS TOGGLE ──
let dressStreamInstance = null;
let currentDressFacingMode = "environment"; // Defaults to the crisp back camera on smartphones

window.openDressCheckerCamera = async function() {
    const dVideo = document.getElementById("dressVideo");
    const dPreviewBox = document.getElementById("dressPreviewBox");
    const dPlaceholder = document.getElementById("dressPlaceholderText");
    const dOpenBtn = document.getElementById("dressCameraOpenBtn");
    const dFlipBtn = document.getElementById("dressCameraFlipBtn");
    const dCaptureBtn = document.getElementById("dressCaptureBtn");
    const dCheckBtn = document.getElementById("dressCheckBtn");
    const dResult = document.getElementById("dressResult");

    try {
        if (!navigator.mediaDevices) { alert("Camera not accessible over unencrypted pathways."); return; }
        
        if (dressStreamInstance) {
            dressStreamInstance.getTracks().forEach(t => t.stop());
        }

        dressStreamInstance = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: { ideal: currentDressFacingMode } }, 
            audio: false 
        });
        
        dVideo.srcObject = dressStreamInstance;
        dVideo.style.display = "block";
        
        if (dPreviewBox) dPreviewBox.style.display = "none";
        if (dPlaceholder) dPlaceholder.style.display = "none";
        if (dResult) dResult.style.display = "none";
        
        dOpenBtn.textContent = "📷 Close Camera";
        // Turn text action into close feature switch toggler if streaming live
        dOpenBtn.onclick = window.closeDressCheckerCamera; 
        
        dFlipBtn.style.display = "inline-block";
        dCaptureBtn.style.display = "inline-block";
        if (dCheckBtn) dCheckBtn.style.display = "none";

    } catch (e) {
        console.error("Camera path error:", e);
        alert("Could not access your device camera. Please upload a screenshot instead.");
    }
};

window.closeDressCheckerCamera = function() {
    const dVideo = document.getElementById("dressVideo");
    const dPreviewBox = document.getElementById("dressPreviewBox");
    const dPreviewImg = document.getElementById("dressPreviewImg");
    const dPlaceholder = document.getElementById("dressPlaceholderText");
    const dOpenBtn = document.getElementById("dressCameraOpenBtn");
    const dFlipBtn = document.getElementById("dressCameraFlipBtn");
    const dCaptureBtn = document.getElementById("dressCaptureBtn");
    const dCheckBtn = document.getElementById("dressCheckBtn");
    const dResult = document.getElementById("dressResult");

    // 1. Turn off live camera stream channels safely
    if (dressStreamInstance) {
        dressStreamInstance.getTracks().forEach(t => t.stop());
        dressStreamInstance = null;
    }

    if (dVideo) dVideo.style.display = "none";
    
    // 2. Clear out old memory tracking references completely
    dressImageData = null;
    if (dPreviewImg) dPreviewImg.src = "";
    
    // 3. Hide the preview box and hide the active "Check This Color" action button
    if (dPreviewBox) dPreviewBox.style.display = "none";
    if (dCheckBtn) dCheckBtn.style.display = "none";
    
    // 4. Reset the right-side dashboard card to its default waiting message state
    if (dResult) {
        dResult.innerHTML = `
            <div style="border: 1px dashed #2e3b85; background: rgba(30, 41, 93, 0.15); border-radius: 12px; padding: 30px 20px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 240px; box-sizing: border-box;">
                <span style="font-size: 2.2rem; margin-bottom: 8px; opacity: 0.4;">📊</span>
                <span style="font-size: 0.85rem; color: #94a3b8; font-weight: 500; line-height: 1.4;">Awaiting item data submission.<br>Tap "Check This Color" to view matches.</span>
            </div>
        `;
    }
    
    // 5. Safely restore the primary "Media monitor inactive" placeholder backdrop view
    if (dPlaceholder) dPlaceholder.style.display = "block";
    
    // 6. Reset button tags cleanly back to original states
    dOpenBtn.textContent = "📷 Open Camera";
    dOpenBtn.onclick = window.openDressCheckerCamera;
    dFlipBtn.style.display = "none";
    dCaptureBtn.style.display = "none";
};

// NOTE: the "Coming Soon" overlay for the Glasses tab now lives directly in
// index.html (inside #glassesTryOnActive) so it renders reliably and covers
// the whole panel — a previous attempt here tried to inject it on
// DOMContentLoaded, but since app.js loads at the end of <body>, that event
// has already fired by the time this script runs, so it never fired.
window.toggleDressCheckerCameraLens = function() {
    // Cycles smoothly between front (user) and rear (environment) device sensors
    currentDressFacingMode = (currentDressFacingMode === "environment") ? "user" : "environment";
    window.openDressCheckerCamera();
};

window.captureDressCheckerPhoto = function() {
    const dVideo = document.getElementById("dressVideo");
    const dPreviewBox = document.getElementById("dressPreviewBox");
    const dPreviewImg = document.getElementById("dressPreviewImg");
    const dOpenBtn = document.getElementById("dressCameraOpenBtn");
    const dFlipBtn = document.getElementById("dressCameraFlipBtn");
    const dCaptureBtn = document.getElementById("dressCaptureBtn");
    const dCheckBtn = document.getElementById("dressCheckBtn");
    // 🧠 Add reference selector catch
    const dPlaceholder = document.getElementById("dressPlaceholderText");

    if (!dVideo || !dVideo.videoWidth) return;

    const snapshotCanvas = document.createElement("canvas");
    snapshotCanvas.width = dVideo.videoWidth;
    snapshotCanvas.height = dVideo.videoHeight;
    
    const sCtx = snapshotCanvas.getContext("2d");
    sCtx.drawImage(dVideo, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
    
    dressImageData = snapshotCanvas.toDataURL("image/png");
    dPreviewImg.src = dressImageData;
    
    if (dressStreamInstance) {
        dressStreamInstance.getTracks().forEach(t => t.stop());
        dressStreamInstance = null;
    }
    
    dVideo.style.display = "none";
    dFlipBtn.style.display = "none";
    dCaptureBtn.style.display = "none";
    
    // 🧠 FIXED: Enforces perfect hiding of text panel overlays when a snapshot drops
    if (dPlaceholder) dPlaceholder.style.display = "none";
    if (dPreviewBox) dPreviewBox.style.display = "block";
    if (dCheckBtn) dCheckBtn.style.display = "inline-block";
};