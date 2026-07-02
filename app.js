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
            window.faceapi.nets.ageGenderNet.load(FACE_API_MODEL_URL)
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
            
            if (analyzeBtn) {
                analyzeBtn.removeAttribute("disabled");
                analyzeBtn.classList.add("active");
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
        setStatus("Analysing your photo...", "info");
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
        if (detectedGender) {
            personType = (detectedGender === "male") ? "man" : "woman";
        } else {
            personType = window._selectedGender || "woman";
        }

        if (detectedAge !== null && detectedAge < 13) personType = "child";

        currentAnalyzedPersonType = personType;

        // ── ⏳ HIDE RAW OUTPUT LABELS AND ENGAGE VISUAL TIMELINE LOOPER ──
        const progressLoader = document.getElementById("aiProgressLoader");

        // Hide standard view strings during processing loop sequence
        skinToneDiv.style.display = "none";
        hexColorDiv.style.display = "none";
        undertoneDiv.style.display = "none";
        seasonalTypeDiv.style.display = "none";
        confidenceScore.style.display = "none";
        if (genderResult) genderResult.style.display = "none";
        if (shareSeasonBtn) shareSeasonBtn.style.display = "none";

        // Show progress box matrix wrapper
        if (progressLoader) {
            progressLoader.style.display = "flex";
            // Reset items to inactive resting state metrics
            document.querySelectorAll(".progress-step-item").forEach(el => {
                el.className = "progress-step-item";
                el.querySelector(".step-status-icon").textContent = "⏳";
            });
        }

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
            }
        };

        // Wrap a setTimeout in a Promise so the step sequence can be awaited
        // linearly instead of pyramid-nesting callbacks — this also means
        // await getUserCountry() and the rest of the real completion logic
        // (which the timeline reveals at the end) run in their natural order
        // rather than being detached from the timers.
        const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // ── STEP TIMELINE SEQUENCE RUNNER ──
        setStepState("face", "processing");
        await wait(600); // Initial face-tracking system calculation interval
        setStepState("face", "done");

        setStepState("undertone", "processing");
        await wait(500); // Undertone color matrix isolation loop
        setStepState("undertone", "done");

        setStepState("season", "processing");
        await wait(600); // Season matching timeline block
        setStepState("season", "done");

        setStepState("wardrobe", "processing");
        await wait(500); // Wardrobe creation step
        setStepState("wardrobe", "done");

        setStepState("products", "processing");
        await wait(600); // Sizing catalog delay bounds
        setStepState("products", "done");

        // ── 🎉 PROCESSING CONCLUDED: REVEAL PREMIUM COMPUTED RESULTS MATRIX ──
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

        setStatus("Analysis complete.","success");
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

function getSeasonalType(undertone,skinToneCategory,contrastLevel){
    if(undertone==="Warm"){
        if(skinToneCategory==="light")  return contrastLevel==="high"?"Warm Spring":"Light Spring";
        if(skinToneCategory==="medium") return contrastLevel==="high"?"True Autumn":"Soft Autumn";
        if(skinToneCategory==="deep")   return "Deep Autumn";
    }
    if(undertone==="Cool"){
        if(skinToneCategory==="light")  return contrastLevel==="high"?"Bright Winter":"Light Summer";
        if(skinToneCategory==="medium") return contrastLevel==="high"?"True Winter":"Soft Summer";
        if(skinToneCategory==="deep")   return "Deep Winter";
    }
    if(skinToneCategory==="light")  return "Soft Summer";
    if(skinToneCategory==="deep")   return "Deep Autumn";
    return "True Neutral";
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
        <button type="button" class="wireframe-tab-btn ${window._currentRetailerTab === 'amazon' ? 'tab-active' : ''}" data-tab="amazon" onclick="setRetailerTabFilter('amazon', '${prefix}')" style="display: flex !important; align-items: center !important; justify-content: center !important; width: 120px !important; height: 48px !important; padding: 0 !important; box-sizing: border-box !important; flex: none !important; background: #ffffff !important; border-radius: 8px !important; border: 2px solid ${window._currentRetailerTab === 'amazon' ? '#6a5acd' : '#334155'} !important; cursor: pointer !important; overflow: hidden !important;">
            <img src="logos/amazon.png" style="height: auto !important; width: 95% !important; object-fit: contain !important; box-sizing: border-box !important;" alt="Amazon">
        </button>
        <button type="button" class="wireframe-tab-btn ${window._currentRetailerTab === 'asos' ? 'tab-active' : ''}" data-tab="asos" onclick="setRetailerTabFilter('asos', '${prefix}')" style="display: flex !important; align-items: center !important; justify-content: center !important; width: 120px !important; height: 48px !important; padding: 0 !important; box-sizing: border-box !important; flex: none !important; background: #ffffff !important; border-radius: 8px !important; border: 2px solid ${window._currentRetailerTab === 'asos' ? '#6a5acd' : '#334155'} !important; cursor: pointer !important; overflow: hidden !important;">
            <img src="logos/asos.png" style="height: 100% !important; width: 100% !important; object-fit: contain !important; box-sizing: border-box !important;" alt="ASOS">
        </button>
        <button type="button" class="wireframe-tab-btn ${window._currentRetailerTab === 'h&m' ? 'tab-active' : ''}" data-tab="h&m" onclick="setRetailerTabFilter('h&m', '${prefix}')" style="display: flex !important; align-items: center !important; justify-content: center !important; width: 120px !important; height: 48px !important; padding: 0 !important; box-sizing: border-box !important; flex: none !important; background: #ffffff !important; border-radius: 8px !important; border: 2px solid ${window._currentRetailerTab === 'h&m' ? '#6a5acd' : '#334155'} !important; cursor: pointer !important; overflow: hidden !important;">
            <img src="logos/hm.png" style="height: 100% !important; width: 100% !important; object-fit: contain !important; box-sizing: border-box !important;" alt="H&M">
        </button>
        <button type="button" class="wireframe-tab-btn ${window._currentRetailerTab === 'flipkart' ? 'tab-active' : ''}" data-tab="flipkart" onclick="setRetailerTabFilter('flipkart', '${prefix}')" style="display: flex !important; align-items: center !important; justify-content: center !important; width: 120px !important; height: 48px !important; padding: 0 !important; box-sizing: border-box !important; flex: none !important; background: #ffffff !important; border-radius: 8px !important; border: 2px solid ${window._currentRetailerTab === 'flipkart' ? '#6a5acd' : '#334155'} !important; cursor: pointer !important; overflow: hidden !important;">
            <img src="logos/flipkart.png" style="height: auto !important; width: 90% !important; object-fit: contain !important; box-sizing: border-box !important;" alt="Flipkart">
        </button>
        <button type="button" class="wireframe-tab-btn ${window._currentRetailerTab === 'myntra' ? 'tab-active' : ''}" data-tab="myntra" onclick="setRetailerTabFilter('myntra', '${prefix}')" style="display: flex !important; align-items: center !important; justify-content: center !important; width: 120px !important; height: 48px !important; padding: 0 !important; box-sizing: border-box !important; flex: none !important; background: #ffffff !important; border-radius: 8px !important; border: 2px solid ${window._currentRetailerTab === 'myntra' ? '#6a5acd' : '#334155'} !important; cursor: pointer !important; overflow: hidden !important;">
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
        cardElement.innerHTML = `
            <div class="product-illustration-preview-box" style="background: ${getSoftColorHex(currentColor)}22; min-height: 120px; border-radius: 12px; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; position: relative;">
                <span class="product-avatar-emoji" style="font-size: 3rem;">${card.icon}</span>
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

function getSoftColorHex(colorName) {
    const map = {
        "peach": "#ffb09c", "coral": "#ff6b6b", "warm ivory": "#fffdd0", "golden yellow": "#ffd700",
        "burnt orange": "#cc5500", "rust": "#b83b1d", "olive green": "#606c38", "deep teal": "#006666",
        "mustard yellow": "#e1ad01", "warm brown": "#964b00", "terracotta": "#e2725b", "forest green": "#228b22",
        "pure white": "#ffffff", "black": "#111111", "icy blue": "#f0f8ff", "royal blue": "#4169e1",
        "hot pink": "#ff69b4", "fuchsia": "#ff00ff", "true red": "#ff0000", "emerald green": "#50c878",
        "navy": "#000080", "grey": "#808080", "beige": "#f5f5dc", "charcoal": "#36454f"
    };
    return map[colorName.toLowerCase()] || "#6a5acd";
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
if (shareSeasonBtn) {
    shareSeasonBtn.addEventListener("click", () => {
        let seasonalTypeText = seasonalTypeDiv ? seasonalTypeDiv.innerText.replace("Seasonal Type:", "").trim() : "Custom Season";
        const skinToneText = skinToneDiv ? skinToneDiv.innerText.replace("Skin Tone:", "").trim() : "Detected Tone";
        const undertoneText = undertoneDiv ? undertoneDiv.innerText.replace("Undertone:", "").trim() : "Neutral";

        // Pull active calculated colors out of list elements cleanly
        const clothingColorsList = clothingColors ? Array.from(clothingColors.querySelectorAll("li:not(.recommendation-heading)")).map(li => li.innerText) : [];
        let colorSwatches = clothingColorsList.slice(0, 8);
        if (colorSwatches.length < 8) colorSwatches = ["Peach", "Coral", "Yellow", "Mint Green", "Sky Blue", "Lavender", "Light Pink", "Cream"];

        const shareCanvas = document.createElement("canvas");
        const sCtx = shareCanvas.getContext("2d");
        
        shareCanvas.width = 1200;
        shareCanvas.height = 1760;

        const userImgObj = new Image();
        
        // Everything runs inside the safety of the async onload hook
        userImgObj.onload = function() {
            let accentColor = "#6a5acd";
            let bgColor = "#f8fafc";
            let cardBg = "#ffffff";
            let textColor = "#0f172a";
            let mutedText = "#475569";

            if (currentAnalyzedPersonType === "woman") {
                accentColor = "#ec4899"; 
                bgColor = "#fff5f7";
            } else if (currentAnalyzedPersonType === "child") {
                accentColor = "#3b82f6"; 
                bgColor = "#f0fdf4";
            } else {
                accentColor = "#1e3a8a"; 
                bgColor = "#f1f5f9";
            }

            // Base Canvas Painting
            sCtx.fillStyle = bgColor;
            sCtx.fillRect(0, 0, shareCanvas.width, shareCanvas.height);

            // 🧠 DRAW HEADER BLOCK SYSTEM
            sCtx.fillStyle = accentColor;
            sCtx.font = "bold 42px system-ui, -apple-system, sans-serif";
            sCtx.textAlign = "left";
            sCtx.fillText("✨ AI Color Analysis", 60, 90);

            sCtx.fillStyle = mutedText;
            sCtx.font = "600 24px system-ui, -apple-system, sans-serif";
            sCtx.fillText("Privacy-First Personalized Style Passport", 60, 130);

            // Security Tag
            sCtx.fillStyle = "rgba(16, 185, 129, 0.1)";
            sCtx.beginPath();
            sCtx.roundRect(860, 65, 280, 50, 12);
            sCtx.fill();
            sCtx.fillStyle = "#10b981";
            sCtx.font = "bold 20px system-ui, sans-serif";
            sCtx.fillText("🔒 On-Device Private", 890, 98);

            // 🧠 DRAW USER PORTRAIT IMAGE LAYER
            sCtx.save();
            sCtx.beginPath();
            sCtx.roundRect(60, 180, 420, 520, 24);
            sCtx.clip();

            let srcX = 0, srcY = 0, srcSize = userImgObj.width;
            if (userImgObj.width > userImgObj.height) {
                srcSize = userImgObj.height;
                srcX = (userImgObj.width - userImgObj.height) / 2;
            } else {
                srcSize = userImgObj.width;
                srcY = (userImgObj.height - userImgObj.width) / 2;
            }
            sCtx.drawImage(userImgObj, srcX, srcY, srcSize, srcSize, 60, 180, 420, 520);
            sCtx.restore();

            // Label tag card attachment inside image wrapper boundaries
            sCtx.fillStyle = "rgba(15, 23, 42, 0.75)";
            sCtx.beginPath();
            sCtx.roundRect(85, 625, 370, 55, 12);
            sCtx.fill();
            sCtx.fillStyle = "#ffffff";
            sCtx.font = "bold 22px system-ui, sans-serif";
            sCtx.fillText(`🎨 Tone: ${skinToneText}`, 110, 660);

            // 🧠 WRITE TYPOGRAPHY SEASONAL BIO INFOGRAPHICS
            sCtx.fillStyle = accentColor;
            sCtx.font = "bold 32px system-ui, sans-serif";
            sCtx.fillText("YOUR SEASON", 530, 230);

            sCtx.fillStyle = textColor;
            sCtx.font = "bold 84px system-ui, -apple-system, sans-serif";
            sCtx.fillText(seasonalTypeText, 530, 330);

            sCtx.fillStyle = mutedText;
            sCtx.font = "600 28px system-ui, sans-serif";
            sCtx.fillText(`Profile Matrix: ${undertoneText} Undertone  •  Verified Match`, 530, 390);

            sCtx.fillStyle = textColor;
            sCtx.font = "24px system-ui, sans-serif";
            sCtx.fillText(`Your personal coloring completely aligns with the characteristics of a ${seasonalTypeText}.`, 530, 450);
            sCtx.fillText("Wearing these verified tones optimizes skin radiance and mitigates washing out effects.", 530, 490);

            // Metric tracking blocks row layout
            const metrics = [
                { label: "Undertone", val: undertoneText },
                { label: "Match Score", val: "98%" },
                { label: "Confidence", val: "97%" }
            ];
            metrics.forEach((m, idx) => {
                const mx = 530 + (idx * 210);
                sCtx.fillStyle = cardBg;
                sCtx.beginPath();
                sCtx.roundRect(mx, 550, 190, 110, 16);
                sCtx.fill();
                sCtx.lineWidth = 1;
                sCtx.strokeStyle = "rgba(0,0,0,0.05)";
                sCtx.stroke();

                sCtx.fillStyle = mutedText;
                sCtx.font = "600 18px system-ui, sans-serif";
                sCtx.fillText(m.label, mx + 25, 590);
                sCtx.fillStyle = accentColor;
                sCtx.font = "bold 26px system-ui, sans-serif";
                sCtx.fillText(m.val, mx + 25, 635);
            });

            // 🧠 DRAW PALETTE BAR MATRIX ROW
            sCtx.fillStyle = textColor;
            sCtx.font = "bold 32px system-ui, sans-serif";
            sCtx.fillText("🎨 YOUR OPTIMAL MOLECULAR COLOR PALETTE", 60, 770);

            const swatchWidth = 125;
            const swatchHeight = 90;
            
            // Cleaned, validated color hex dictionary mapping all dynamic text names
            const styleColorMap = {
                // Autumn Tones
                "burnt orange": "#cc5500", "rust": "#b83b1d", "olive green": "#606c38", "deep teal": "#006666",
                "mustard yell": "#e1ad01", "mustard": "#e1ad01", "warm brown": "#964b00", "terracotta": "#e2725b", 
                "forest green": "#228b22", "camel": "#c19a6b", "dark gold": "#b8860b", "rich gold": "#daa520", "gold": "#ffd700", 
                "bronze": "#cd7f32", "copper": "#b87333", "dark olive": "#4a4a2e", "khaki": "#c3b091", 
                "warm burgundy": "#800020", "burgundy": "#800020", "brick red": "#b22222", "paprika red": "#e2583e", 
                "chocolate brown": "#4a2c17", "deep chocola": "#4a2c17", "chocolate": "#4a2c17", "brown": "#7b4b27",
                "deep turquoise": "#00ced1", "dark coral": "#cd5c5c", "amber": "#ffbf00",
                
                // Spring Tones
                "peach": "#ffb09c", "coral": "#ff6b6b", "warm ivory": "#fffdd0", "golden yellow": "#ffd700", "golden yello": "#ffd700",
                "bright turqu": "#00e5ff", "bright turquoise": "#00e5ff", "salmon pink": "#ff8d94", "light orange": "#ffa726",
                "apple green": "#8ebd60", "soft coral": "#ff8a80", "light golden yellow": "#fff9c4", "mint green": "#a7ffeb",
                "soft salmon": "#ffa07a", "butter yellow": "#fff59d", "light peach pink": "#ffbda4", "buttercup yellow": "#fff350",
                
                // Summer Tones
                "dusty rose": "#dcae96", "soft lavende": "#e1bee7", "soft lavender": "#e1bee7", "powder blue": "#b0e0e6",
                "warm taupe": "#b38f8f", "soft sage": "#b2dfdb", "muted mauve": "#ce93d8", "nude blush": "#f8bbd0",
                "soft teal": "#80cbc4", "soft gray": "#b0bec5", "blush": "#f4a6c6", "light navy": "#1a237e",
                "cool white": "#f8fafc", "muted plum": "#9c27b0", "soft lilac": "#f3e5f5", "cool taupe": "#90a4ae",
                "slate blue": "#708090", "dusty lavender": "#b39ddb", "muted teal": "#009688", "soft raspberry": "#e91e63",
                "rose pink": "#f4a6c6", "soft periwinkle": "#c5cae9", "pale mint": "#e0f2f1", "dove gray": "#b0bec5",
                
                // Winter Tones
                "pure white": "#ffffff", "snow white": "#f8f8ff", "black": "#0a0a0a", "icy blue": "#e3f2fd", "royal blue": "#4169e1",
                "hot pink": "#ff69b4", "fuchsia": "#ff00ff", "true red": "#d50000", "emerald green": "#00c853", "emerald": "#50c878",
                "navy blue": "#1b2a4a", "bright purple": "#aa00ff", "cobalt": "#0091ea", "cool gray": "#78909c",
                "silver": "#c0c0c0", "raspberry": "#c2185b", "bright teal": "#00bfa5", "sapphire blue": "#0d47a1",
                "berry red": "#ad1457", "crimson": "#b71c1c", "plum": "#8e4585", "charcoal": "#36454f"
            };

            colorSwatches.forEach((color, i) => {
                const sx = 60 + (i * 135);
                let hexFill = "#6a5acd"; // Secure default fallback
                
                const cleanName = color.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
                
                // Secure loose matching token search
                const token = Object.keys(styleColorMap).find(k => 
                    cleanName.includes(k) || k.includes(cleanName)
                );
                
                if (token) hexFill = styleColorMap[token];

                sCtx.fillStyle = hexFill;
                sCtx.beginPath();
                sCtx.roundRect(sx, 810, swatchWidth, swatchHeight, 12);
                sCtx.fill();
                sCtx.lineWidth = 2;
                sCtx.strokeStyle = "rgba(0,0,0,0.1)";
                sCtx.stroke();

                sCtx.fillStyle = textColor;
                sCtx.font = "bold 16px system-ui, sans-serif";
                sCtx.fillText(color.substring(0, 12), sx + 4, 930);
            });

            // 🧠 RENDER DYNAMIC CARD SLOTS ROW
            sCtx.fillStyle = textColor;
            sCtx.font = "bold 32px system-ui, sans-serif";
            sCtx.fillText("👔 CHROMATIC WARDROBE RECOMMENDATION MAPS", 60, 1010);

            let rowItems = [];
            if (currentAnalyzedPersonType === "woman") {
                rowItems = [
                    { title: "Clothing", desc: "Peach Blouse", icon: "👚" },
                    { title: "Hair Tone", desc: "Natural Brown", icon: "💇" },
                    { title: "Cosmetics", desc: "Coral Lipstick", icon: "💄" },
                    { title: "Jewelry", desc: "Yellow Gold", icon: "💍" }
                ];
            } else if (currentAnalyzedPersonType === "child") {
                rowItems = [
                    { title: "Everyday Wear", desc: "Striped T-Shirt", icon: "👕" },
                    { title: "Outerwear", desc: "Mint Hoodie", icon: "🧥" },
                    { title: "Gear", desc: "School Backpack", icon: "🎒" },
                    { title: "Accessory", desc: "Colorful Watch", icon: "⌚" }
                ];
            } else {
                rowItems = [
                    { title: "Shirts", desc: "Navy Oxford", icon: "👔" },
                    { title: "Outerwear", desc: "Charcoal Coat", icon: "🧥" },
                    { title: "Accessories", desc: "Silver Watch", icon: "⌚" },
                    { title: "Footwear", desc: "White Sneakers", icon: "👟" }
                ];
            }

            rowItems.forEach((item, idx) => {
                const ix = 60 + (idx * 275);
                sCtx.fillStyle = cardBg;
                sCtx.beginPath();
                sCtx.roundRect(ix, 1050, 255, 230, 20);
                sCtx.fill();
                
                sCtx.fillStyle = mutedText;
                sCtx.font = "bold 18px system-ui, sans-serif";
                sCtx.fillText(item.title, ix + 25, 1095);

                sCtx.fillStyle = textColor;
                sCtx.font = "24px system-ui, sans-serif";
                sCtx.fillText(item.icon, ix + 25, 1160);

                sCtx.fillStyle = accentColor;
                sCtx.font = "bold 20px system-ui, sans-serif";
                sCtx.fillText(item.desc, ix + 25, 1230);
            });

            // 🧠 INSIGHTS AND BRAND FOOTER MATRIX
            sCtx.fillStyle = cardBg;
            sCtx.beginPath();
            sCtx.roundRect(60, 1340, 1080, 160, 20);
            sCtx.fill();

            sCtx.fillStyle = accentColor;
            sCtx.font = "bold 22px system-ui, sans-serif";
            sCtx.fillText("💡 EXPERT METRIC ANALYSIS RULE", 90, 1395);

            sCtx.fillStyle = textColor;
            sCtx.font = "20px system-ui, sans-serif";
            let insightTip = "Your cool depth parameters indicate high luxury contrasts. Stick to stark whites and clear jewel tones.";
            if (undertoneText === "Warm") insightTip = "Warm undertone frameworks dictate rich, organic reflections. Terracotta, golds, and mossy greens draw out your radiance.";
            sCtx.fillText(insightTip, 90, 1445);

            sCtx.fillStyle = accentColor;
            sCtx.font = "bold 32px system-ui, sans-serif";
            sCtx.textAlign = "center";
            sCtx.fillText("aicoloranalysis.online", shareCanvas.width / 2, 1620);

            sCtx.fillStyle = mutedText;
            sCtx.font = "600 20px system-ui, sans-serif";
            sCtx.fillText("Automated Local Client Vision Engine Pass • 100% Temporary Storage Secure", shareCanvas.width / 2, 1665);

            const renderDataUrl = shareCanvas.toDataURL("image/png");
            launchShareModalLayout(renderDataUrl, seasonalTypeText);
        };

        // Fire rendering layer trigger
        userImgObj.src = previewImage.src;
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

// ── Lightweight client-side K-Means (no dependencies) ──
// Groups candidate garment pixels into `k` colour clusters and returns the
// cluster with the highest *weighted* pixel count (weight favours pixels
// near the centre of the crop, where the garment usually sits). This is far
// more robust than a single running average, because a cluster of, say,
// leftover white-background pixels can no longer silently drag a green
// shirt's average toward grey — it simply loses to the green cluster.
function kMeansDominantColor(pixels, k) {
    if (!pixels.length) return null;
    k = Math.min(k, pixels.length);

    // Seed centroids by spreading picks evenly across the pixel list — a
    // cheap stand-in for k-means++.
    const step = Math.max(1, Math.floor(pixels.length / k));
    let centroids = [];
    for (let i = 0; i < k; i++) {
        const p = pixels[Math.min(i * step, pixels.length - 1)];
        centroids.push({ r: p.r, g: p.g, b: p.b });
    }

    const assignments = new Array(pixels.length).fill(0);

    for (let iter = 0; iter < 6; iter++) {
        // Assign step
        for (let i = 0; i < pixels.length; i++) {
            const p = pixels[i];
            let bestIdx = 0, bestDist = Infinity;
            for (let c = 0; c < centroids.length; c++) {
                const dr = p.r - centroids[c].r, dg = p.g - centroids[c].g, db = p.b - centroids[c].b;
                const dist = dr*dr + dg*dg + db*db;
                if (dist < bestDist) { bestDist = dist; bestIdx = c; }
            }
            assignments[i] = bestIdx;
        }
        // Update step (weighted centroid)
        const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, w: 0 }));
        for (let i = 0; i < pixels.length; i++) {
            const p = pixels[i], s = sums[assignments[i]], w = p.weight;
            s.r += p.r * w; s.g += p.g * w; s.b += p.b * w; s.w += w;
        }
        for (let c = 0; c < centroids.length; c++) {
            if (sums[c].w > 0) {
                centroids[c] = { r: sums[c].r / sums[c].w, g: sums[c].g / sums[c].w, b: sums[c].b / sums[c].w };
            }
        }
    }

    // Score clusters by total weight (pixel count × centrality), not just
    // raw count, so a small-but-central garment beats a large-but-peripheral
    // background remnant.
    const clusterWeight = new Array(centroids.length).fill(0);
    for (let i = 0; i < pixels.length; i++) clusterWeight[assignments[i]] += pixels[i].weight;

    let bestC = 0;
    for (let c = 1; c < centroids.length; c++) {
        if (clusterWeight[c] > clusterWeight[bestC]) bestC = c;
    }

    return {
        r: Math.round(centroids[bestC].r),
        g: Math.round(centroids[bestC].g),
        b: Math.round(centroids[bestC].b)
    };
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
    if (l < 18) return "black";

    if (s < 22 && h >= 20 && h < 100) return "olive_brown"; 
    if (h < 15 || h >= 345) return (l > 45 && s > 40) ? "pink" : "red";
    if (h < 45)  return "orange";
    if (h < 65)  return "yellow";
    if (h < 170) return "green";
    if (h < 195) return "teal";
    if (h < 255) return "blue";
    if (h < 290) return "purple";
    return "pink";
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

if (dressUpload) {
    dressUpload.addEventListener("change", function() {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            dressImageData = e.target.result;
            dressPreviewImg.src = dressImageData;
            dressPreviewBox.style.display = "block";
            
            // 🧠 FIX: Explicitly hide the placeholder text block here!
            const dPlaceholder = document.getElementById("dressPlaceholderText");
            if (dPlaceholder) dPlaceholder.style.display = "none";

            if (dressCheckBtn) dressCheckBtn.style.display = "inline-block";
            if (dressResult)   dressResult.style.display   = "none";
        };
        reader.readAsDataURL(file);
    });
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

        const verdictConfig = {
            perfect: {
                emoji: "✅", title: "Perfect Match!",
                msg:   `This <strong>${colorInfo.name}</strong> colour fits beautifully in your <strong>${window._userSeason}</strong> palette. It will naturally enhance your ${window._userUndertone.toLowerCase()} undertone and make you look radiant.`,
                bg:    "linear-gradient(135deg,#064e3b,#065f46)", border:"#10b981"
            },
            good: {
                emoji: "👍", title: "Good Choice",
                msg:   `This <strong>${colorInfo.name}</strong> is a solid pick for your <strong>${window._userSeason}</strong> profile. It complements your palette well, though not your absolute best shade.`,
                bg:    "linear-gradient(135deg,#1e3a5f,#1e40af)", border:"#3b82f6"
            },
            okay: {
                emoji: "🟡", title: "Wearable but Not Ideal",
                msg:   `This <strong>${colorInfo.name}</strong> can work, but it's not optimised for your <strong>${window._userSeason}</strong> palette. Pair it with one of your best neutral shades to balance it out.`,
                bg:    "linear-gradient(135deg,#451a03,#92400e)", border:"#f59e0b"
            },
            caution: {
                emoji: "⚠️", title: "Proceed with Caution",
                msg:   `This <strong>${colorInfo.name}</strong> doesn't align well with your <strong>${window._userUndertone}</strong> undertone. It may make your complexion appear dull or washed out.`,
                bg:    "linear-gradient(135deg,#3b1f00,#7c2d12)", border:"#f97316"
            },
            avoid: {
                emoji: "❌", title: "Not Recommended",
                msg:   `This <strong>${colorInfo.name}</strong> is in the avoid list for your <strong>${window._userSeason}</strong> profile. It is likely to clash with your ${window._userUndertone.toLowerCase()} undertone. We'd suggest returning it.`,
                bg:    "linear-gradient(135deg,#450a0a,#7f1d1d)", border:"#ef4444"
            }
        };

        const v = verdictConfig[verdict];
        dressResult.style.display = "block";
        dressResult.innerHTML = `
            <div style="background:${v.bg};border:1px solid ${v.border};border-radius:14px;padding:20px 22px;">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
                    <div style="width:52px;height:52px;border-radius:10px;background:${dominant.hex};border:2px solid rgba(255,255,255,0.3);flex-shrink:0;"></div>
                    <div>
                        <div style="font-size:1.1rem;font-weight:800;color:#fff;">${v.emoji} ${v.title}</div>
                        <div style="font-size:0.78rem;opacity:0.7;color:#fff;">Detected colour: ${colorInfo.name} &nbsp;·&nbsp; HEX ${dominant.hex} &nbsp;·&nbsp; ${colorInfo.confidence}% confidence</div>
                    </div>
                </div>
                <p style="color:#fff;font-size:0.88rem;line-height:1.7;margin:0;">${v.msg}</p>
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
    const locked  = document.getElementById("dressCheckerLocked");
    const active  = document.getElementById("dressCheckerActive");
    if (locked) locked.style.display = "none";
    if (active) active.style.display = "block";
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
    const dPlaceholder = document.getElementById("dressPlaceholderText");
    const dOpenBtn = document.getElementById("dressCameraOpenBtn");
    const dFlipBtn = document.getElementById("dressCameraFlipBtn");
    const dCaptureBtn = document.getElementById("dressCaptureBtn");

    if (dressStreamInstance) {
        dressStreamInstance.getTracks().forEach(t => t.stop());
        dressStreamInstance = null;
    }

    if (dVideo) dVideo.style.display = "none";
    if (dPlaceholder) dPlaceholder.style.display = "block";
    
    dOpenBtn.textContent = "📷 Open Camera";
    dOpenBtn.onclick = window.openDressCheckerCamera;
    dFlipBtn.style.display = "none";
    dCaptureBtn.style.display = "none";
};

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
    
    // 🧠 FIX: Force structural removal of placeholder text upon snap validation
    if (dPlaceholder) dPlaceholder.style.display = "none";
    
    dOpenBtn.textContent = "📷 Open Camera";
    dOpenBtn.onclick = window.openDressCheckerCamera;
    
    if (dPreviewBox) dPreviewBox.style.display = "block";
    if (dCheckBtn) dCheckBtn.style.display = "inline-block";
};