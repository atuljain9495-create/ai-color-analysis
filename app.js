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
let currentFacingMode = "environment";
let faceDetector = null;
let faceApiReady = false;
let faceApiFailed = false;
const FACE_API_MODEL_URL = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights";

function applyDarkModeUI() {
    if (!darkModeBtn) return;

    const isDark = document.body.classList.contains("dark-mode");
    darkModeBtn.textContent = isDark ? "☀️" : "🌙";
    darkModeBtn.setAttribute(
        "aria-label",
        isDark ? "Switch to light mode" : "Switch to dark mode"
    );
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
    if (faceApiReady || faceApiFailed) {
        return;
    }

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

    if (faceDetector || typeof window.FaceDetector === "undefined") {
        return;
    }

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
                new window.faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
            );
            return detection ? [detection] : [];
        } catch (error) {
            console.warn("Face API detection failed:", error);
        }
    }

    if (!faceDetector) {
        return detectFaceLikeRegion(imageElement);
    }

    try {
        const bitmap = await createImageBitmap(imageElement);
        const faces = await faceDetector.detect(bitmap);
        bitmap.close && bitmap.close();
        return faces;
    } catch (error) {
        console.warn("FaceDetector failed:", error);
        return detectFaceLikeRegion(imageElement);
    }
}

function detectFaceLikeRegion(imageElement) {
    const width = imageElement.naturalWidth || imageElement.width;
    const height = imageElement.naturalHeight || imageElement.height;

    if (!width || !height) {
        return [];
    }

    const tempCanvas = document.createElement("canvas");
    const ctx = tempCanvas.getContext("2d", { willReadFrequently: true });

    tempCanvas.width = width;
    tempCanvas.height = height;
    ctx.drawImage(imageElement, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let skinPixelCount = 0;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        if (isSkinColor(r, g, b)) {
            const x = (i / 4) % width;
            const y = Math.floor(i / 4 / width);
            skinPixelCount++;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }

    if (skinPixelCount < 600) {
        return [];
    }

    const bboxWidth = maxX - minX + 1;
    const bboxHeight = maxY - minY + 1;
    const bboxArea = bboxWidth * bboxHeight;
    const areaRatio = bboxArea / (width * height);
    const aspectRatio = bboxWidth / bboxHeight;

    if (areaRatio < 0.03 || aspectRatio < 0.45 || aspectRatio > 1.8) {
        return [];
    }

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    if (
        Math.abs(centerX - width / 2) > width * 0.28 ||
        Math.abs(centerY - height / 2) > height * 0.3
    ) {
        return [];
    }

    return [{
        boundingBox: {
            x: minX,
            y: minY,
            width: bboxWidth,
            height: bboxHeight
        }
    }];
}

function isSkinColor(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    return (
        r > 95 &&
        g > 40 &&
        b > 20 &&
        r > g &&
        r > b &&
        delta > 15
    );
}

function getAverageBrightness(data) {
    let total = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        total += (r + g + b) / 3;
        count++;
    }

    return count ? total / count : 0;
}

function getContrastLevel(data) {
    let sum = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const brightness = (r + g + b) / 3;
        sum += brightness;
        count++;
    }

    const mean = count ? sum / count : 0;
    let variance = 0;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const brightness = (r + g + b) / 3;
        variance += Math.pow(brightness - mean, 2);
    }

    const stdDev = count ? Math.sqrt(variance / count) : 0;

    if (stdDev > 55) {
        return "high";
    }
    if (stdDev > 30) {
        return "medium";
    }
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

    if (img.width < 220 || img.height < 220) {
        throw new Error("Face too small. Please upload a closer photo with your face clearly visible.");
    }

    if (brightness < 70) {
        throw new Error("The photo is too dark. Please upload a brighter photo with good lighting.");
    }

    if (brightness > 220) {
        throw new Error("The image looks overexposed. Please upload a photo with balanced lighting.");
    }

    const contrastLevel = getContrastLevel(data);
    if (contrastLevel === "low") {
        throw new Error("The photo looks blurry or flat. Please upload a sharper photo with clear facial detail.");
    }

    await initFaceDetector();
    const faces = await detectFaces(img);

    if (!faces.length) {
        throw new Error("No human face detected. Please upload a clear photo showing your face.");
    }

    if (faces.length > 1) {
        throw new Error("Please upload a photo with one person facing the camera.");
    }

    const face = faces[0];
    const faceBox = face.boundingBox || face.detection?.box || null;

    if (!faceBox) {
        throw new Error("No human face detected. Please upload a clear photo showing your face.");
    }

    const faceAreaRatio = (faceBox.width * faceBox.height) / (img.width * img.height);

    if (faceAreaRatio < 0.05) {
        throw new Error("Face too small. Please upload a closer photo with your face clearly visible.");
    }

    const isNearEdge = faceBox.x < img.width * 0.05 || faceBox.y < img.height * 0.05 ||
        faceBox.x + faceBox.width > img.width * 0.95 || faceBox.y + faceBox.height > img.height * 0.95;

    if (isNearEdge) {
        throw new Error("Please upload a full face photo without the face being cropped at the edges.");
    }

    return {
        brightness,
        contrastLevel,
        faceBox
    };
}

const savedDarkMode = localStorage.getItem("darkMode");
if (savedDarkMode === "true") {
    document.body.classList.add("dark-mode");
}

applyDarkModeUI();
resetResults();

/* Upload Image */

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
            setValidationMessage("Please upload: ✓ One person ✓ Front-facing face ✓ Good lighting ✓ No sunglasses ✓ No filters", "info");
        };

        reader.readAsDataURL(file);
    });
}

/* Open Camera */

async function openCamera() {
    try {
        const mediaDevices = navigator.mediaDevices;

        if (!mediaDevices) {
            alert(
                "Camera API not available.\n\n" +
                "Try opening:\n" +
                "http://localhost:8000\n\n" +
                "instead of:\n" +
                window.location.href
            );
            return;
        }

        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }

        const cameraConstraint = {
            video: {
                facingMode: { ideal: currentFacingMode }
            },
            audio: false
        };

        stream = await mediaDevices.getUserMedia(cameraConstraint);
        video.srcObject = stream;

        if (cameraWrapper) {
            cameraWrapper.style.display = "flex";
        }
        video.style.display = "block";
        if (captureBtn) {
            captureBtn.style.display = "inline-block";
        }

        setStatus(`Camera ready (${currentFacingMode === "user" ? "front" : "rear"}). Click Capture Photo.`, "info");
    } catch (error) {
        console.error("Camera Error:", error);

        let msg = error.message;

        if (error.name === "NotAllowedError") {
            msg = "Camera permission denied.\n\nAllow camera access in your browser settings.";
        }

        if (error.name === "NotFoundError") {
            msg = "No camera detected.";
        }

        if (error.name === "NotReadableError") {
            msg = "Camera is already being used by another application.";
        }

        setStatus(msg, "error");
        alert(msg);
    }
}

if (cameraBtn) {
    cameraBtn.addEventListener("click", () => {
        openCamera();
    });
}

if (cameraSwitchBtn) {
    cameraSwitchBtn.addEventListener("click", () => {
        currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
        openCamera();
    });
}

/* Capture Photo */

if (captureBtn) {
    captureBtn.addEventListener("click", () => {
        if (!video.videoWidth || !video.videoHeight) {
            setStatus("Camera feed is not ready yet.", "error");
            return;
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        uploadedImage = canvas.toDataURL("image/png");

        if (previewImage) {
            previewImage.src = uploadedImage;
            previewImage.style.display = "block";
        }
        if (previewWrapper) {
            previewWrapper.style.display = "flex";
        }
        setStatus("Photo captured successfully.", "success");
        setValidationMessage("Please upload: ✓ One person ✓ Front-facing face ✓ Good lighting ✓ No sunglasses ✓ No filters", "info");

        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }

        video.style.display = "none";
        if (captureBtn) {
            captureBtn.style.display = "none";
        }
    });
}

/* Dark Mode */

if (darkModeBtn) {
    darkModeBtn.addEventListener("click", () => {
        document.body.classList.toggle("dark-mode");
        const isDark = document.body.classList.contains("dark-mode");
        localStorage.setItem("darkMode", isDark ? "true" : "false");
        applyDarkModeUI();
    });
}

/* Analyze Button */

if (analyzeBtn) {
    analyzeBtn.addEventListener("click", async () => {
        if (!uploadedImage) {
            setStatus("Please upload or capture a photo first.", "error");
            return;
        }

        setStatus("Checking your photo and detecting a face...", "info");
        skinToneDiv.innerHTML = "🔍 Analyzing your skin tone...";
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
            setValidationMessage("Please upload: ✓ One person ✓ Front-facing face ✓ Good lighting ✓ No sunglasses ✓ No filters", "error");
            if (skinToneDiv) {
                skinToneDiv.innerHTML = `⚠️ ${error.message}`;
            }
        }
    });
}

/* Analyze Skin */

function analyzeSkinTone(imageSrc, validationResult = {}) {
    const img = new Image();

    img.onload = function () {
        const tempCanvas = document.createElement("canvas");
        const ctx = tempCanvas.getContext("2d", { willReadFrequently: true });

        tempCanvas.width = img.width;
        tempCanvas.height = img.height;

        ctx.drawImage(img, 0, 0);

        const sampleWidth = Math.floor(img.width * 0.28);
        const sampleHeight = Math.floor(img.height * 0.28);
        const startX = Math.floor(img.width * 0.36);
        const startY = Math.floor(img.height * 0.28);

        const imageData = ctx.getImageData(startX, startY, sampleWidth, sampleHeight);
        const data = imageData.data;

        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;

        for (let i = 0; i < data.length; i += 4) {
            const red = data[i];
            const green = data[i + 1];
            const blue = data[i + 2];

            if (red > 60 && green > 40 && blue > 20 && red > blue) {
                r += red;
                g += green;
                b += blue;
                count++;
            }
        }

        if (count === 0) {
            setStatus("Unable to detect skin. Try another photo.", "error");
            return;
        }

        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);

        const hex = rgbToHex(r, g, b);
        const totalPixels = sampleWidth * sampleHeight;
        const confidencePercent = Math.min(100, Math.round((count / totalPixels) * 100));
        const brightness = (r + g + b) / 3;

        let skinTone = "";
        let undertone = "";
        let skinToneCategory = "medium";

        if (brightness > 210) {
            skinTone = "Very Fair";
            skinToneCategory = "light";
        } else if (brightness > 175) {
            skinTone = "Fair";
            skinToneCategory = "light";
        } else if (brightness > 145) {
            skinTone = "Light Beige";
            skinToneCategory = "light";
        } else if (brightness > 115) {
            skinTone = "Medium Beige";
            skinToneCategory = "medium";
        } else if (brightness > 90) {
            skinTone = "Tan";
            skinToneCategory = "medium";
        } else {
            skinTone = "Deep Brown";
            skinToneCategory = "deep";
        }

        if (r > b + 20) {
            undertone = "Warm";
        } else if (b > r + 20) {
            undertone = "Cool";
        } else {
            undertone = "Neutral";
        }

        const contrastLevel = validationResult.contrastLevel || "medium";
        const seasonalType = getSeasonalType(undertone, skinToneCategory, contrastLevel);

        skinToneDiv.innerHTML = `<strong>Skin Tone:</strong> ${skinTone}`;
        hexColorDiv.innerHTML = `
            <strong>HEX Color:</strong> ${hex}
            <div style="width:100px;height:100px;background:${hex};border-radius:12px;margin-top:10px;border:2px solid #ddd;"></div>
        `;
        undertoneDiv.innerHTML = `<strong>Undertone:</strong> ${undertone}`;
        seasonalTypeDiv.innerHTML = `<strong>Seasonal Type:</strong> ${seasonalType}`;
        confidenceScore.innerHTML = `<strong>Detection Confidence:</strong> ${confidencePercent}%`;
        setStatus("Analysis complete. Review your personalized palette below.", "success");
        setValidationMessage("Great photo quality. Your palette is based on face detection, undertone, and contrast.", "success");

        generateRecommendations(undertone, skinToneCategory, contrastLevel);
    };

    img.src = imageSrc;
}

function getSeasonalType(undertone, skinToneCategory, contrastLevel) {
    if (undertone === "Warm") {
        if (skinToneCategory === "light") {
            return contrastLevel === "high" ? "Warm Spring" : "Soft Autumn";
        }
        if (skinToneCategory === "deep") {
            return "Deep Autumn";
        }
        return "Soft Autumn";
    }

    if (undertone === "Cool") {
        if (skinToneCategory === "light") {
            return contrastLevel === "high" ? "Bright Winter" : "Soft Summer";
        }
        if (skinToneCategory === "deep") {
            return "Deep Winter";
        }
        return "True Winter";
    }

    if (skinToneCategory === "light") {
        return "Soft Summer";
    }
    if (skinToneCategory === "deep") {
        return "Deep Autumn";
    }
    return "True Neutral";
}

function generateRecommendations(undertone, skinToneCategory, contrastLevel) {
    clearRecommendations();

    const palette = getPalette(undertone, skinToneCategory, contrastLevel);
    const hairPalette = getHairPalette(undertone, skinToneCategory);
    const jewelryPalette = getJewelryPalette(undertone, skinToneCategory);

    renderList(clothingColors, palette.best, "Best Colors");
    renderList(clothingColors, palette.good, "Good Colors");
    renderList(clothingColors, palette.avoid, "Avoid");

    renderList(hairColors, hairPalette.best, "Best Hair Colors");
    renderList(hairColors, hairPalette.avoid, "Avoid");

    renderList(jewelryColors, jewelryPalette.best, "Best Jewelry");
    renderList(jewelryColors, jewelryPalette.avoid, "Avoid");
}

function renderList(container, colors, label) {
    if (!container) return;

    const title = document.createElement("li");
    title.className = "recommendation-heading";
    title.textContent = label;
    container.appendChild(title);

    colors.forEach(color => {
        const li = document.createElement("li");
        li.textContent = color;
        container.appendChild(li);
    });
}

function getPalette(undertone, skinToneCategory, contrastLevel) {
    if (undertone === "Warm") {
        if (skinToneCategory === "light") {
            return {
                best: ["Peach", "Coral", "Light Camel", "Ivory", "Sage Green"],
                good: ["Cream", "Soft Teal", "Muted Gold"],
                avoid: ["Neon Yellow", "Harsh Black", "Bright Orange"]
            };
        }
        if (skinToneCategory === "deep") {
            return {
                best: ["Burnt Orange", "Chocolate Brown", "Burgundy", "Deep Olive", "Gold"],
                good: ["Rust", "Moss", "Deep Teal"],
                avoid: ["Pale Beige", "Cool Lavender", "Ice Blue"]
            };
        }
        return {
            best: ["Olive Green", "Mustard", "Rust", "Camel", "Cream"],
            good: ["Terracotta", "Sage", "Warm Brown"],
            avoid: ["Neon Yellow", "Cold Gray", "Icy Blue"]
        };
    }

    if (undertone === "Cool") {
        if (skinToneCategory === "light") {
            return {
                best: ["Lavender", "Powder Blue", "Rose Pink", "Navy", "Charcoal"],
                good: ["Soft White", "Muted Plum", "Silver Gray"],
                avoid: ["Mustard", "Orange", "Beige"]
            };
        }
        if (skinToneCategory === "deep") {
            return {
                best: ["Royal Blue", "Fuchsia", "Pure White", "Deep Purple", "Black"],
                good: ["Emerald", "Berry", "Cool Gray"],
                avoid: ["Warm Brown", "Camel", "Olive"]
            };
        }
        return {
            best: ["Emerald", "Sapphire Blue", "Berry", "Plum", "Cool Gray"],
            good: ["Navy", "Rose", "Silver"],
            avoid: ["Mustard", "Terracotta", "Beige"]
        };
    }

    return {
        best: ["Teal", "Dusty Rose", "Taupe", "Soft Navy", "Forest Green"],
        good: ["Soft White", "Warm Gray", "Muted Blue"],
        avoid: ["Neon Yellow", "Bright Orange", "Harsh Beige"]
    };
}

function getHairPalette(undertone, skinToneCategory) {
    if (undertone === "Warm") {
        if (skinToneCategory === "deep") {
            return { best: ["Chestnut", "Warm Brown", "Deep Auburn"], avoid: ["Ash Blonde", "Platinum"] };
        }
        return { best: ["Golden Brown", "Honey Blonde", "Soft Auburn"], avoid: ["Cool Black", "Blue-Black"] };
    }

    if (undertone === "Cool") {
        if (skinToneCategory === "deep") {
            return { best: ["Jet Black", "Cool Brown", "Deep Burgundy"], avoid: ["Golden Blonde", "Copper"] };
        }
        return { best: ["Ash Brown", "Cool Black", "Burgundy"], avoid: ["Golden Honey", "Warm Auburn"] };
    }

    return { best: ["Natural Brown", "Soft Black", "Dark Espresso"], avoid: ["Neon Red", "Platinum"] };
}

function getJewelryPalette(undertone, skinToneCategory) {
    if (undertone === "Warm") {
        return { best: ["Gold", "Rose Gold", "Bronze"], avoid: ["Silver", "White Gold"] };
    }

    if (undertone === "Cool") {
        return { best: ["Silver", "White Gold", "Platinum"], avoid: ["Bronze", "Yellow Gold"] };
    }

    return { best: ["Gold", "Silver", "Rose Gold"], avoid: ["Very Bright Yellow", "Neon"] };
}

/* RGB To HEX */

function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? "0" + hex : hex;
    }).join("");
}