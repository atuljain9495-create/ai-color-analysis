const imageUpload = document.getElementById("imageUpload");
const previewImage = document.getElementById("previewImage");
const analyzeBtn = document.getElementById("analyzeBtn");

const skinToneDiv = document.getElementById("skinTone");
const hexColorDiv = document.getElementById("hexColor");
const undertoneDiv = document.getElementById("undertone");
const seasonalTypeDiv = document.getElementById("seasonalType");

const clothingColors = document.getElementById("clothingColors");
const hairColors = document.getElementById("hairColors");
const jewelryColors = document.getElementById("jewelryColors");

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");

const cameraBtn = document.getElementById("cameraBtn");
const cameraSwitchBtn = document.getElementById("cameraSwitchBtn");
const captureBtn = document.getElementById("captureBtn");
const cameraStatus = document.getElementById("cameraStatus");
const validationMessage = document.getElementById("validationMessage");
const darkModeBtn = document.getElementById("darkModeBtn");
const confidenceScore = document.getElementById("confidenceScore");
const cameraWrapper = document.querySelector(".camera-wrapper");
const previewWrapper = document.querySelector(".preview-wrapper");

let uploadedImage = null;
let stream = null;
let currentFacingMode = "user";
let faceDetector = null;
let faceApiReady = false;
let faceApiFailed = false;
const FACE_API_MODEL_URL = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights/";

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

function setValidationMessage(message, type = "info") {
    if (!validationMessage) return;
    validationMessage.textContent = message;
    validationMessage.className = `validation-message ${type}`;
}

function clearRecommendations() {
    if (clothingColors) clothingColors.innerHTML = "";
    if (hairColors) hairColors.innerHTML = "";
    if (jewelryColors) jewelryColors.innerHTML = "";
}

function resetResults() {
    if (skinToneDiv) skinToneDiv.innerHTML = "Waiting for analysis...";
    if (hexColorDiv) hexColorDiv.innerHTML = "";
    if (undertoneDiv) undertoneDiv.innerHTML = "";
    if (seasonalTypeDiv) seasonalTypeDiv.innerHTML = "";
    if (confidenceScore) confidenceScore.innerHTML = "";
    clearRecommendations();
}

function loadImageFromSource(imageSrc) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Unable to load the selected image."));
        img.src = imageSrc;
    });
}

async function initFaceDetector() {
    if (faceApiReady || faceApiFailed) return;
    if (typeof window.faceapi !== "undefined" && window.faceapi.nets && window.faceapi.nets.tinyFaceDetector) {
        try {
            await window.faceapi.nets.tinyFaceDetector.load(FACE_API_MODEL_URL);
            faceApiReady = true;
            return;
        } catch (error) {
            console.warn("Face API models failed to load:", error);
            faceApiFailed = true;
        }
    }
    if (faceDetector || typeof window.FaceDetector === "undefined") return;
    try {
        faceDetector = new window.FaceDetector({ fastMode: true });
    } catch (error) {
        console.warn("FaceDetector not available:", error);
    }
}

async function detectFaces(imageElement) {
    if (typeof window.faceapi !== "undefined" && faceApiReady) {
        try {
            const detection = await window.faceapi.detectSingleFace(
                imageElement,
                new window.faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.15 })
            );
            if (detection) return [detection];
            const allFaces = await window.faceapi.detectAllFaces(
                imageElement,
                new window.faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.12 })
            );
            return allFaces || [];
        } catch (error) {
            console.warn("Face API detection failed:", error);
        }
    }
    if (typeof window.FaceDetector !== "undefined") {
        try {
            const bitmap = await createImageBitmap(imageElement);
            const faces = await faceDetector.detect(bitmap);
            bitmap.close && bitmap.close();
            return faces || [];
        } catch (error) {
            console.warn("FaceDetector failed:", error);
        }
    }
    return [];
}

function getAverageBrightness(data) {
    let total = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
        total += (data[i] + data[i + 1] + data[i + 2]) / 3;
        count++;
    }
    return count ? total / count : 0;
}

function getContrastLevel(data) {
    let sum = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
        sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
        count++;
    }
    const mean = count ? sum / count : 0;
    let variance = 0;
    for (let i = 0; i < data.length; i += 4) {
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        variance += Math.pow(brightness - mean, 2);
    }
    const stdDev = count ? Math.sqrt(variance / count) : 0;
    if (stdDev > 50) return "high";
    if (stdDev > 25) return "medium";
    return "low";
}

async function validatePhoto(imageSrc) {
    const img = await loadImageFromSource(imageSrc);
    const tempCanvas = document.createElement("canvas");
    const ctx = tempCanvas.getContext("2d", { willReadFrequently: true });
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;
    ctx.drawImage(img, 0, 0, img.width, img.height);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    const data = imageData.data;
    const brightness = getAverageBrightness(data);
    if (img.width < 150 || img.height < 150) throw new Error("Image resolution too low. Please use a clearer photo.");
    if (brightness < 45) throw new Error("Photo is too dark. Move closer to a window or turn on a light.");
    if (brightness > 240) throw new Error("Photo is overexposed. Avoid direct flash or harsh light.");
    const contrastLevel = getContrastLevel(data);
    await initFaceDetector();
    const faces = await detectFaces(img);
    let faceBox = null;
    if (faces && faces.length > 0) {
        const face = faces[0];
        faceBox = face.boundingBox || face.box || face.detection?.box || null;
    }
    return { brightness, contrastLevel, faceBox };
}

/* Init */
const savedDarkMode = localStorage.getItem("darkMode");
if (savedDarkMode === "true") document.body.classList.add("dark-mode");
applyDarkModeUI();
resetResults();

if (imageUpload) {
    imageUpload.addEventListener("change", function () {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (e) {
            uploadedImage = e.target.result;
            previewImage.src = uploadedImage;
            previewWrapper.style.display = "flex";
            previewImage.style.display = "block";
            setValidationMessage("Photo uploaded. Ready to analyze.", "info");
        };
        reader.readAsDataURL(file);
    });
}

async function openCamera() {
    try {
        const mediaDevices = navigator.mediaDevices;
        if (!mediaDevices) { alert("Camera not accessible. Ensure your site uses HTTPS."); return; }
        if (stream) stream.getTracks().forEach(track => track.stop());
        stream = await mediaDevices.getUserMedia({ video: { facingMode: { ideal: currentFacingMode } }, audio: false });
        video.srcObject = stream;
        if (cameraWrapper) cameraWrapper.style.display = "flex";
        video.style.display = "block";
        if (captureBtn) captureBtn.style.display = "inline-block";
        setStatus(`Camera ready (${currentFacingMode === "user" ? "selfie" : "back"} camera).`, "info");
    } catch (error) {
        setStatus("Could not start camera. Use file upload instead.", "error");
    }
}

if (cameraBtn) cameraBtn.addEventListener("click", openCamera);
if (cameraSwitchBtn) {
    cameraSwitchBtn.addEventListener("click", () => {
        currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
        openCamera();
    });
}

if (captureBtn) {
    captureBtn.addEventListener("click", () => {
        if (!video.videoWidth || !video.videoHeight) { setStatus("Camera warming up. Try again.", "error"); return; }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        uploadedImage = canvas.toDataURL("image/png");
        if (previewImage) { previewImage.src = uploadedImage; previewImage.style.display = "block"; }
        if (previewWrapper) previewWrapper.style.display = "flex";
        setStatus("Photo captured!", "success");
        if (stream) { stream.getTracks().forEach(track => track.stop()); stream = null; }
        video.style.display = "none";
        captureBtn.style.display = "none";
    });
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
        if (!uploadedImage) { setStatus("Please upload or capture a photo first.", "error"); return; }
        setStatus("Analysing your photo...", "info");
        skinToneDiv.innerHTML = "🔍 Reading your skin tone...";
        hexColorDiv.innerHTML = "";
        undertoneDiv.innerHTML = "";
        seasonalTypeDiv.innerHTML = "";
        confidenceScore.innerHTML = "";
        clearRecommendations();
        try {
            const validationResult = await validatePhoto(uploadedImage);
            analyzeSkinTone(uploadedImage, validationResult);
        } catch (error) {
            resetResults();
            setStatus(error.message, "error");
            setValidationMessage("Please check your photo lighting and try again.", "error");
            if (skinToneDiv) skinToneDiv.innerHTML = `⚠️ ${error.message}`;
        }
    });
}

/* ── SKIN ANALYSER ── */
function analyzeSkinTone(imageSrc, validationResult = {}) {
    const img = new Image();
    img.onload = function () {
        const tempCanvas = document.createElement("canvas");
        const ctx = tempCanvas.getContext("2d", { willReadFrequently: true });
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const box = validationResult.faceBox;
        let startX, startY, sampleWidth, sampleHeight;

        if (box && typeof box.x !== "undefined" && box.width > 10 && box.height > 10) {
            sampleWidth = Math.floor(box.width * 0.25);
            sampleHeight = Math.floor(box.height * 0.22);
            startX = Math.floor(box.x + (box.width - sampleWidth) / 2);
            startY = Math.floor(box.y + (box.height * 0.32));
        } else {
            sampleWidth = Math.floor(img.width * 0.25);
            sampleHeight = Math.floor(img.height * 0.25);
            startX = Math.floor((img.width - sampleWidth) / 2);
            startY = Math.floor((img.height - sampleHeight) / 2);
        }

        startX = Math.max(0, Math.min(startX, img.width - sampleWidth));
        startY = Math.max(0, Math.min(startY, img.height - sampleHeight));

        const imageData = ctx.getImageData(startX, startY, sampleWidth, sampleHeight);
        const data = imageData.data;

        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
            const red = data[i], green = data[i + 1], blue = data[i + 2];
            if (red > 45 && green > 30 && red > blue && red > green) {
                r += red; g += green; b += blue; count++;
            }
        }

        if (count < 10) {
            r = 0; g = 0; b = 0; count = 0;
            for (let i = 0; i < data.length; i += 4) {
                r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
            }
        }

        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);

        const hex = rgbToHex(r, g, b);
        const totalPixels = sampleWidth * sampleHeight;
        const confidencePercent = Math.min(100, Math.max(45, Math.round((count / totalPixels) * 100)));
        const brightness = (r + g + b) / 3;

        /* Skin tone classification — 7 levels */
        let skinTone, skinToneCategory;
        if (brightness > 210)      { skinTone = "Very Fair / Porcelain";  skinToneCategory = "light"; }
        else if (brightness > 185) { skinTone = "Fair / Light";           skinToneCategory = "light"; }
        else if (brightness > 160) { skinTone = "Light Beige";            skinToneCategory = "light"; }
        else if (brightness > 135) { skinTone = "Medium Beige";           skinToneCategory = "medium"; }
        else if (brightness > 110) { skinTone = "Tan / Olive";            skinToneCategory = "medium"; }
        else if (brightness > 80)  { skinTone = "Deep Brown";             skinToneCategory = "deep"; }
        else                       { skinTone = "Very Deep / Ebony";      skinToneCategory = "deep"; }

        /* Undertone — refined 3-factor ratio check */
        let undertone = "Neutral";
        const warmScore = (r - b) + (r - g) * 0.5;
        const coolScore = (b - r) * 0.8 + (b - g) * 0.5;

        if (warmScore > 22)       undertone = "Warm";
        else if (coolScore > 8)   undertone = "Cool";

        const contrastLevel = validationResult.contrastLevel || "medium";
        const seasonalType = getSeasonalType(undertone, skinToneCategory, contrastLevel);

        skinToneDiv.innerHTML   = `<strong>Skin Tone:</strong> ${skinTone}`;
        hexColorDiv.innerHTML   = `<strong>Detected HEX:</strong> ${hex}<div style="width:80px;height:80px;background:${hex};border-radius:10px;margin-top:8px;border:2px solid #ddd;"></div>`;
        undertoneDiv.innerHTML  = `<strong>Undertone:</strong> ${undertone}`;
        seasonalTypeDiv.innerHTML = `<strong>Seasonal Type:</strong> ${seasonalType}`;
        confidenceScore.innerHTML = `<strong>Detection Confidence:</strong> ${confidencePercent}%`;

        setStatus("Analysis complete.", "success");
        setValidationMessage("Your personalised color palette is ready below.", "success");

        generateRecommendations(undertone, skinToneCategory, contrastLevel);
    };
    img.src = imageSrc;
}

/* ── SEASONAL TYPE ENGINE ── */
function getSeasonalType(undertone, skinToneCategory, contrastLevel) {
    if (undertone === "Warm") {
        if (skinToneCategory === "light")  return contrastLevel === "high" ? "Warm Spring" : "Light Spring";
        if (skinToneCategory === "medium") return contrastLevel === "high" ? "True Autumn" : "Soft Autumn";
        if (skinToneCategory === "deep")   return "Deep Autumn";
    }
    if (undertone === "Cool") {
        if (skinToneCategory === "light")  return contrastLevel === "high" ? "Bright Winter" : "Light Summer";
        if (skinToneCategory === "medium") return contrastLevel === "high" ? "True Winter"   : "Soft Summer";
        if (skinToneCategory === "deep")   return "Deep Winter";
    }
    /* Neutral */
    if (skinToneCategory === "light")  return "Soft Summer";
    if (skinToneCategory === "deep")   return "Deep Autumn";
    return "True Neutral";
}

/* ── RECOMMENDATION GENERATOR ── */
function generateRecommendations(undertone, skinToneCategory, contrastLevel) {
    clearRecommendations();
    const palette  = getClothingPalette(undertone, skinToneCategory, contrastLevel);
    const hair     = getHairPalette(undertone, skinToneCategory);
    const jewelry  = getJewelryPalette(undertone, skinToneCategory);

    renderSection(clothingColors, "✅ Best Clothing Colors",  palette.best);
    renderSection(clothingColors, "👍 Good Clothing Colors",  palette.good);
    renderSection(clothingColors, "✨ Accent Colors",         palette.accent);
    renderSection(clothingColors, "🔲 Best Neutrals",         palette.neutrals);
    renderSection(clothingColors, "❌ Colors to Avoid",       palette.avoid);

    renderSection(hairColors, "✅ Best Hair Colors",          hair.best);
    renderSection(hairColors, "👍 Good Hair Colors",          hair.good);
    renderSection(hairColors, "💡 Highlight Suggestions",     hair.highlights);
    renderSection(hairColors, "❌ Hair Colors to Avoid",      hair.avoid);

    renderSection(jewelryColors, "✅ Best Metal",             jewelry.best);
    renderSection(jewelryColors, "💎 Best Gem Colors",        jewelry.gems);
    renderSection(jewelryColors, "👍 Also Works",             jewelry.secondary);
    renderSection(jewelryColors, "❌ Avoid",                  jewelry.avoid);
}

function renderSection(container, label, items) {
    if (!container || !items || items.length === 0) return;
    const heading = document.createElement("li");
    heading.className = "recommendation-heading";
    heading.textContent = label;
    container.appendChild(heading);
    items.forEach(item => {
        const li = document.createElement("li");
        li.innerHTML = item;
        container.appendChild(li);
    });
}

/* ══════════════════════════════════════
   CLOTHING PALETTE — 9 detailed profiles
   ══════════════════════════════════════ */
function getClothingPalette(undertone, skinToneCategory, contrastLevel) {

    /* ── WARM LIGHT ── */
    if (undertone === "Warm" && skinToneCategory === "light") {
        if (contrastLevel === "high") {
            // Warm Spring
            return {
                best:    ["Peach", "Coral", "Warm Ivory", "Golden Yellow", "Bright Turquoise", "Salmon Pink", "Light Orange", "Apple Green"],
                good:    ["Camel", "Warm White", "Aqua", "Soft Teal", "Buttercup Yellow", "Warm Lilac", "Champagne"],
                accent:  ["Poppy Red", "Cobalt Blue", "Bright Coral", "Lime Green"],
                neutrals:["Warm White", "Light Camel", "Ivory", "Cream", "Sand"],
                avoid:   ["Black", "Harsh Charcoal", "Cool Gray", "Ice Blue", "Silver Gray", "Deep Burgundy", "Cool Lavender"]
            };
        }
        // Light Spring
        return {
            best:    ["Peach", "Soft Coral", "Warm Ivory", "Light Golden Yellow", "Mint Green", "Soft Salmon", "Butter Yellow", "Light Peach Pink"],
            good:    ["Champagne", "Soft Aqua", "Warm Cream", "Blush Pink", "Light Camel", "Soft Sage", "Nude Beige"],
            accent:  ["Warm Rose", "Soft Orange", "Muted Coral", "Dusty Gold"],
            neutrals:["Warm White", "Cream", "Ivory", "Light Tan", "Soft Beige"],
            avoid:   ["Black", "Cool Gray", "Royal Blue", "Stark White", "Burgundy", "Cool Purple", "Navy"]
        };
    }

    /* ── WARM MEDIUM ── */
    if (undertone === "Warm" && skinToneCategory === "medium") {
        if (contrastLevel === "high") {
            // True Autumn
            return {
                best:    ["Burnt Orange", "Rust", "Olive Green", "Deep Teal", "Mustard Yellow", "Warm Brown", "Terracotta", "Forest Green"],
                good:    ["Camel", "Dark Gold", "Bronze", "Copper", "Dark Olive", "Khaki", "Warm Burgundy", "Chocolate"],
                accent:  ["Paprika Red", "Deep Turquoise", "Dark Coral", "Amber"],
                neutrals:["Camel", "Warm Taupe", "Chocolate Brown", "Dark Khaki", "Warm Beige"],
                avoid:   ["Black", "Cool Lavender", "Icy Blue", "Pale Pink", "Silver", "Cool Gray", "Bright Neon"]
            };
        }
        // Soft Autumn
        return {
            best:    ["Olive Green", "Muted Mustard", "Soft Rust", "Warm Taupe", "Sage Green", "Dusty Peach", "Muted Teal", "Warm Camel"],
            good:    ["Warm Brown", "Soft Terracotta", "Muted Gold", "Khaki", "Moss Green", "Dusty Rose", "Warm Gray"],
            accent:  ["Deep Coral", "Muted Amber", "Warm Mauve", "Dusty Jade"],
            neutrals:["Warm Taupe", "Camel", "Warm Beige", "Soft Khaki", "Light Brown"],
            avoid:   ["Bright Black", "Icy Pastels", "Cool Lavender", "Bright Neon", "Silver Gray", "Stark White"]
        };
    }

    /* ── WARM DEEP ── */
    if (undertone === "Warm" && skinToneCategory === "deep") {
        return {
            best:    ["Burnt Orange", "Deep Chocolate Brown", "Warm Burgundy", "Dark Olive", "Rich Gold", "Deep Teal", "Paprika Red", "Brick Red"],
            good:    ["Camel", "Deep Mustard", "Copper", "Forest Green", "Warm Black", "Bronze", "Rust", "Dark Coral"],
            accent:  ["Bright Orange", "Deep Yellow", "Rich Turquoise", "Mango"],
            neutrals:["Warm Black", "Chocolate Brown", "Dark Camel", "Deep Khaki", "Rich Taupe"],
            avoid:   ["Pale Pastel Pink", "Icy Blue", "Cool Lavender", "Silver", "Powder Blue", "Soft Mint"]
        };
    }

    /* ── COOL LIGHT ── */
    if (undertone === "Cool" && skinToneCategory === "light") {
        if (contrastLevel === "high") {
            // Bright Winter
            return {
                best:    ["Pure White", "Black", "Icy Blue", "Royal Blue", "Hot Pink", "Fuchsia", "True Red", "Emerald Green"],
                good:    ["Navy", "Bright Purple", "Cobalt", "Cool Gray", "Silver", "Raspberry", "Bright Teal"],
                accent:  ["Electric Blue", "Bright Magenta", "Stark Lemon Yellow", "Pure Red"],
                neutrals:["Pure White", "Black", "Cool Gray", "Navy", "Charcoal"],
                avoid:   ["Camel", "Orange", "Warm Beige", "Mustard", "Brown", "Warm Gold", "Peach"]
            };
        }
        // Light Summer
        return {
            best:    ["Soft Lavender", "Powder Blue", "Rose Pink", "Soft Mauve", "Icy Blue", "Dusty Rose", "Soft Periwinkle", "Pale Mint"],
            good:    ["Soft Gray", "Blush", "Light Navy", "Soft Sage", "Cool White", "Muted Plum", "Soft Lilac"],
            accent:  ["Dusty Rose", "Soft Teal", "Muted Berry", "Soft Orchid"],
            neutrals:["Soft White", "Dove Gray", "Cool Beige", "Powder Gray", "Light Silver"],
            avoid:   ["Orange", "Mustard", "Brown", "Warm Beige", "Camel", "Rust", "Terracotta"]
        };
    }

    /* ── COOL MEDIUM ── */
    if (undertone === "Cool" && skinToneCategory === "medium") {
        if (contrastLevel === "high") {
            // True Winter
            return {
                best:    ["True White", "Charcoal", "Navy", "Sapphire Blue", "Emerald", "Berry Red", "Fuchsia", "Deep Purple"],
                good:    ["Black", "Royal Purple", "Deep Teal", "Cobalt", "Cool Gray", "Crimson", "Plum"],
                accent:  ["Electric Blue", "Magenta", "Bright Emerald", "Pure Lemon"],
                neutrals:["Charcoal", "True White", "Navy", "Cool Gray", "Black"],
                avoid:   ["Orange", "Camel", "Warm Brown", "Mustard", "Rust", "Golden Yellow", "Warm Beige"]
            };
        }
        // Soft Summer
        return {
            best:    ["Dusty Rose", "Muted Mauve", "Cool Taupe", "Soft Plum", "Slate Blue", "Dusty Lavender", "Muted Teal", "Soft Raspberry"],
            good:    ["Cool Gray", "Soft Navy", "Muted Sage", "Dusty Pink", "Soft Orchid", "Cool Beige", "Pewter"],
            accent:  ["Soft Berry", "Dusty Blue", "Muted Coral", "Soft Grape"],
            neutrals:["Cool Gray", "Dove White", "Soft Navy", "Cool Taupe", "Warm Gray"],
            avoid:   ["Orange", "Mustard", "Camel", "Rust", "Warm Brown", "Bright Yellow", "Warm Gold"]
        };
    }

    /* ── COOL DEEP ── */
    if (undertone === "Cool" && skinToneCategory === "deep") {
        return {
            best:    ["True Black", "Pure White", "Royal Blue", "Fuchsia", "Emerald Green", "Deep Purple", "Bright Red", "Cobalt"],
            good:    ["Deep Navy", "Cool Burgundy", "Bright Teal", "Raspberry", "Charcoal", "Berry", "Icy Silver"],
            accent:  ["Electric Blue", "Hot Pink", "Bright Lime", "Stark Yellow"],
            neutrals:["Black", "True White", "Charcoal", "Navy", "Cool Gray"],
            avoid:   ["Orange", "Camel", "Warm Brown", "Mustard", "Rust", "Golden Yellow", "Beige"]
        };
    }

    /* ── NEUTRAL LIGHT ── Soft Summer */
    if (skinToneCategory === "light") {
        return {
            best:    ["Dusty Rose", "Soft Lavender", "Powder Blue", "Warm Taupe", "Soft Sage", "Muted Mauve", "Nude Blush", "Soft Teal"],
            good:    ["Warm White", "Cool Gray", "Soft Navy", "Muted Peach", "Dusty Lilac", "Soft Khaki", "Pale Gold"],
            accent:  ["Soft Berry", "Muted Coral", "Warm Lavender", "Soft Jade"],
            neutrals:["Warm White", "Cool Beige", "Soft Gray", "Dove", "Nude"],
            avoid:   ["Neon Yellow", "Harsh Black", "Very Bright Orange", "Stark White"]
        };
    }

    /* ── NEUTRAL MEDIUM ── True Neutral */
    if (skinToneCategory === "medium") {
        return {
            best:    ["Dusty Teal", "Warm Mauve", "Soft Navy", "Camel", "Forest Green", "Dusty Rose", "Warm Slate", "Muted Coral"],
            good:    ["Warm Gray", "Muted Gold", "Soft Brown", "Dusty Blue", "Warm Khaki", "Soft Olive", "Dusty Plum"],
            accent:  ["Warm Teal", "Muted Berry", "Soft Amber", "Dusty Lavender"],
            neutrals:["Warm Taupe", "Warm Gray", "Camel", "Soft Ivory", "Warm Beige"],
            avoid:   ["Neon Yellow", "Very Bright Orange", "Icy Pastels", "Harsh Black"]
        };
    }

    /* ── NEUTRAL DEEP ── Deep Autumn */
    return {
        best:    ["Deep Teal", "Warm Burgundy", "Olive Green", "Rust", "Burnt Orange", "Deep Navy", "Chocolate Brown", "Forest Green"],
        good:    ["Dark Gold", "Paprika", "Deep Coral", "Warm Brown", "Copper", "Dark Khaki", "Dark Olive"],
        accent:  ["Bright Coral", "Deep Turquoise", "Mango", "Deep Amber"],
        neutrals:["Dark Brown", "Warm Black", "Dark Taupe", "Deep Khaki", "Espresso"],
        avoid:   ["Pale Pink", "Icy Blue", "Soft Lavender", "Mint", "Powder Blue", "Silver"]
    };
}

/* ══════════════════════════════════════
   HAIR PALETTE — detailed per profile
   ══════════════════════════════════════ */
function getHairPalette(undertone, skinToneCategory) {

    if (undertone === "Warm" && skinToneCategory === "light") {
        return {
            best:       ["Golden Blonde", "Honey Blonde", "Strawberry Blonde", "Light Copper"],
            good:       ["Sandy Brown", "Warm Light Brown", "Peach Blonde", "Caramel"],
            highlights: ["Sunlit Golden Highlights", "Honey Balayage", "Warm Champagne Highlights"],
            avoid:      ["Ash Blonde", "Cool Black", "Blue-Black", "Platinum", "Cool Brown"]
        };
    }
    if (undertone === "Warm" && skinToneCategory === "medium") {
        return {
            best:       ["Chestnut Brown", "Warm Auburn", "Honey Brown", "Golden Brown", "Copper"],
            good:       ["Rich Caramel", "Warm Mahogany", "Dark Honey Blonde", "Warm Medium Brown"],
            highlights: ["Caramel Balayage", "Copper Highlights", "Auburn Streaks", "Gold Face-Framing"],
            avoid:      ["Ash Brown", "Cool Dark Brown", "Platinum Blonde", "Blue-Black", "Silver Gray"]
        };
    }
    if (undertone === "Warm" && skinToneCategory === "deep") {
        return {
            best:       ["Rich Chestnut", "Warm Dark Brown", "Deep Auburn", "Warm Espresso", "Mahogany"],
            good:       ["Dark Copper", "Deep Warm Brown", "Rich Chocolate", "Warm Black-Brown"],
            highlights: ["Copper Highlights", "Warm Auburn Streaks", "Bronze Shimmer", "Deep Gold Highlights"],
            avoid:      ["Platinum Blonde", "Ash Brown", "Cool Black", "Gray Tones", "Blue-Black"]
        };
    }
    if (undertone === "Cool" && skinToneCategory === "light") {
        return {
            best:       ["Ash Blonde", "Platinum Blonde", "Cool Light Brown", "Sandy Ash"],
            good:       ["Light Cool Brown", "Beige Blonde", "Icy Blonde", "Champagne Blonde"],
            highlights: ["Platinum Highlights", "Ash Blonde Balayage", "Pearl Highlights", "Cool Silver Streaks"],
            avoid:      ["Golden Blonde", "Copper", "Honey Brown", "Warm Auburn", "Red Tones"]
        };
    }
    if (undertone === "Cool" && skinToneCategory === "medium") {
        return {
            best:       ["Ash Brown", "Cool Dark Brown", "Deep Burgundy", "Espresso", "Mocha"],
            good:       ["Dark Ash Blonde", "Cool Mahogany", "Dark Plum", "Blue-Black", "Cool Black"],
            highlights: ["Ash Highlights", "Cool Chestnut Balayage", "Plum Tones", "Deep Violet Shimmer"],
            avoid:      ["Golden Brown", "Copper", "Warm Auburn", "Honey Blonde", "Caramel"]
        };
    }
    if (undertone === "Cool" && skinToneCategory === "deep") {
        return {
            best:       ["Jet Black", "Cool Espresso", "Blue-Black", "Deep Burgundy", "Dark Plum"],
            good:       ["Deep Cool Brown", "Dark Violet", "Deep Mahogany", "Soft Black"],
            highlights: ["Deep Violet Shimmer", "Midnight Blue Tones", "Deep Burgundy Streaks", "Cool Bronze"],
            avoid:      ["Copper", "Warm Auburn", "Golden Honey", "Caramel", "Warm Red"]
        };
    }

    /* Neutral */
    if (skinToneCategory === "light") {
        return {
            best:       ["Natural Blonde", "Light Brown", "Sandy Blonde", "Warm Ash Blonde"],
            good:       ["Golden Brown", "Soft Caramel", "Warm Beige Blonde"],
            highlights: ["Sandy Balayage", "Soft Caramel Highlights", "Natural Sun-Kissed"],
            avoid:      ["Bright Platinum", "Very Dark Black", "Neon Red"]
        };
    }
    if (skinToneCategory === "medium") {
        return {
            best:       ["Natural Brown", "Medium Brown", "Soft Chestnut", "Dark Honey Blonde"],
            good:       ["Warm Brown", "Cool Brown", "Soft Auburn"],
            highlights: ["Natural Balayage", "Soft Caramel Highlights", "Subtle Auburn Streaks"],
            avoid:      ["Platinum Blonde", "Neon Colors", "Very Bright Red"]
        };
    }
    return {
        best:       ["Natural Dark Brown", "Soft Black", "Dark Espresso", "Deep Chocolate"],
        good:       ["Warm Dark Brown", "Deep Mahogany", "Cool Dark Brown"],
        highlights: ["Subtle Bronze", "Deep Auburn Hints", "Dark Gold Shimmer"],
        avoid:      ["Platinum Blonde", "Very Light Colors", "Neon Colors"]
    };
}

/* ══════════════════════════════════════
   JEWELRY PALETTE — detailed
   ══════════════════════════════════════ */
function getJewelryPalette(undertone, skinToneCategory) {

    if (undertone === "Warm") {
        return {
            best:      ["Yellow Gold", "Rose Gold", "Bronze", "Copper", "Brass"],
            gems:      ["Amber", "Citrine", "Topaz", "Carnelian", "Coral", "Peridot", "Turquoise", "Tiger's Eye"],
            secondary: ["Mixed Metal (Gold-dominant)", "Warm-toned Enamel", "Wood & Natural Materials"],
            avoid:     ["Silver", "White Gold", "Platinum", "Cool Blue Sapphire", "Blue Aquamarine"]
        };
    }
    if (undertone === "Cool") {
        return {
            best:      ["Silver", "White Gold", "Platinum", "Palladium"],
            gems:      ["Diamond", "Sapphire", "Amethyst", "Blue Topaz", "Aquamarine", "Ruby", "Tanzanite", "Pearl"],
            secondary: ["Rose Gold (silver-toned)", "Hematite", "Gunmetal"],
            avoid:     ["Yellow Gold", "Copper", "Bronze", "Brass", "Warm Coral Stone"]
        };
    }

    /* Neutral */
    return {
        best:      ["Yellow Gold", "Silver", "Rose Gold — all work equally well"],
        gems:      ["Diamond", "Opal", "Pearl", "Morganite", "Jade", "Moonstone", "Garnet", "Smoky Quartz"],
        secondary: ["Mixed Metals", "Two-tone Jewelry", "Layered Gold & Silver"],
        avoid:     ["Very Neon Enamel", "Overly Bright Plastic Jewelry"]
    };
}

/* ── UTILS ── */
function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? "0" + hex : hex;
    }).join("");
}