const imageUpload = document.getElementById("imageUpload");
const previewImage = document.getElementById("previewImage");
const analyzeBtn = document.getElementById("analyzeBtn");

const skinToneDiv = document.getElementById("skinTone");
const hexColorDiv = document.getElementById("hexColor");
const undertoneDiv = document.getElementById("undertone");

const clothingColors = document.getElementById("clothingColors");
const hairColors = document.getElementById("hairColors");
const jewelryColors = document.getElementById("jewelryColors");

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");

const cameraBtn = document.getElementById("cameraBtn");
const captureBtn = document.getElementById("captureBtn");
const cameraStatus = document.getElementById("cameraStatus");
const darkModeBtn = document.getElementById("darkModeBtn");
const confidenceScore = document.getElementById("confidenceScore");
const cameraWrapper = document.querySelector(".camera-wrapper");
const previewWrapper = document.querySelector(".preview-wrapper");

let uploadedImage = null;
let stream = null;

function applyDarkModeUI() {
    if (!darkModeBtn) return;

    const isDark = document.body.classList.contains("dark-mode");
    darkModeBtn.textContent = isDark ? "☀️" : "🌙";
    darkModeBtn.setAttribute(
        "aria-label",
        isDark ? "Switch to light mode" : "Switch to dark mode"
    );
}

const savedDarkMode = localStorage.getItem("darkMode");
if (savedDarkMode === "true") {
    document.body.classList.add("dark-mode");
}

applyDarkModeUI();

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
    };

    reader.readAsDataURL(file);
});
}

/* Open Camera */

if (cameraBtn) {
cameraBtn.addEventListener("click", async () => {

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

        const rearCameraConstraint = {
            video: {
                facingMode: { ideal: "environment" }
            },
            audio: false
        };

        const frontCameraConstraint = {
            video: {
                facingMode: { ideal: "user" }
            },
            audio: false
        };

        try {
            stream = await mediaDevices.getUserMedia(rearCameraConstraint);
        } catch (rearError) {
            stream = await mediaDevices.getUserMedia(frontCameraConstraint);
        }

        video.srcObject = stream;

        if (cameraWrapper) {
            cameraWrapper.style.display = "flex";
        }
        video.style.display = "block";
        if (captureBtn) {
            captureBtn.style.display = "inline-block";
        }

        if (cameraStatus) {
            cameraStatus.textContent =
                "Camera ready. Click Capture Photo.";
        }

    } catch (error) {

        console.error("Camera Error:", error);

        let msg = error.message;

        if (error.name === "NotAllowedError") {
            msg =
                "Camera permission denied.\n\n" +
                "Allow camera access in your browser settings.";
        }

        if (error.name === "NotFoundError") {
            msg = "No camera detected.";
        }

        if (error.name === "NotReadableError") {
            msg =
                "Camera is already being used by another application.";
        }

        cameraStatus.textContent = msg;
        alert(msg);
    }
});
}

/* Capture Photo */

if (captureBtn) {
captureBtn.addEventListener("click", () => {

    if (!video.videoWidth || !video.videoHeight) {
        cameraStatus.textContent = "Camera feed is not ready yet.";
        return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");

    ctx.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
    );

    uploadedImage = canvas.toDataURL("image/png");

    if (previewImage) {
        previewImage.src = uploadedImage;
        previewImage.style.display = "block";
    }
    if (previewWrapper) {
        previewWrapper.style.display = "flex";
    }
    cameraStatus.textContent = "Photo captured successfully.";

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
analyzeBtn.addEventListener("click", () => {

    if (!uploadedImage) {

        alert("Please upload or capture a photo first.");
        return;
    }

    skinToneDiv.innerHTML = "🔍 Analyzing your skin tone...";
    hexColorDiv.innerHTML = "";
    undertoneDiv.innerHTML = "";
    confidenceScore.innerHTML = "";

    analyzeSkinTone(uploadedImage);
});
}

/* Analyze Skin */

function analyzeSkinTone(imageSrc) {

    const img = new Image();

    img.onload = function () {

        const tempCanvas = document.createElement("canvas");
        const ctx = tempCanvas.getContext("2d");

        tempCanvas.width = img.width;
        tempCanvas.height = img.height;

        ctx.drawImage(img, 0, 0);

        const sampleWidth = Math.floor(img.width * 0.3);
        const sampleHeight = Math.floor(img.height * 0.3);

        const startX = Math.floor(img.width * 0.35);
        const startY = Math.floor(img.height * 0.25);

        const imageData = ctx.getImageData(
            startX,
            startY,
            sampleWidth,
            sampleHeight
        );

        const data = imageData.data;

        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;

        for (let i = 0; i < data.length; i += 4) {

            const red = data[i];
            const green = data[i + 1];
            const blue = data[i + 2];

            if (
                red > 60 &&
                green > 40 &&
                blue > 20 &&
                red > blue
            ) {

                r += red;
                g += green;
                b += blue;

                count++;
            }
        }

        if (count === 0) {

            alert("Unable to detect skin. Try another photo.");

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

       if (brightness > 220) {
    skinTone = "Very Fair";
}
else if (brightness > 190) {
    skinTone = "Fair";
}
else if (brightness > 160) {
    skinTone = "Light Beige";
}
else if (brightness > 130) {
    skinTone = "Medium Beige";
}
else if (brightness > 100) {
    skinTone = "Tan";
}
else {
    skinTone = "Deep Brown";
}

        if (r > b + 20) {
            undertone = "Warm";
        }
        else if (b > r + 20) {
            undertone = "Cool";
        }
        else {
            undertone = "Neutral";
        }

        skinToneDiv.innerHTML =
            `<strong>Skin Tone:</strong> ${skinTone}`;

      hexColorDiv.innerHTML =
`
<strong>HEX Color:</strong> ${hex}

<div style="
width:100px;
height:100px;
background:${hex};
border-radius:12px;
margin-top:10px;
border:2px solid #ddd;
"></div>
`;

        undertoneDiv.innerHTML =
            `<strong>Undertone:</strong> ${undertone}`;

        confidenceScore.innerHTML =
            `<strong>Detection Confidence:</strong> ${confidencePercent}%`;

        generateRecommendations(undertone);
    };

    img.src = imageSrc;
}

/* Recommendations */

function generateRecommendations(undertone) {

    clothingColors.innerHTML = "";
    hairColors.innerHTML = "";
    jewelryColors.innerHTML = "";

    let clothes = [];
    let hair = [];
    let jewelry = [];

    if (undertone === "Warm") {

        clothes = [
            "Olive Green",
            "Mustard Yellow",
            "Terracotta",
            "Camel",
            "Cream"
        ];

        hair = [
            "Golden Brown",
            "Honey Blonde",
            "Chestnut"
        ];

        jewelry = [
            "Gold",
            "Rose Gold"
        ];
    }
    else if (undertone === "Cool") {

        clothes = [
            "Royal Blue",
            "Emerald",
            "Lavender",
            "Charcoal",
            "Navy"
        ];

        hair = [
            "Ash Brown",
            "Cool Black",
            "Burgundy"
        ];

        jewelry = [
            "Silver",
            "White Gold",
            "Platinum"
        ];
    }
    else {

        clothes = [
            "Teal",
            "Dusty Pink",
            "Soft White",
            "Taupe",
            "Slate Blue"
        ];

        hair = [
            "Dark Brown",
            "Soft Black",
            "Natural Brown"
        ];

        jewelry = [
            "Gold",
            "Silver"
        ];
    }

    clothes.forEach(color => {
        const li = document.createElement("li");
        li.textContent = color;
        clothingColors.appendChild(li);
    });

    hair.forEach(color => {
        const li = document.createElement("li");
        li.textContent = color;
        hairColors.appendChild(li);
    });

    jewelry.forEach(color => {
        const li = document.createElement("li");
        li.textContent = color;
        jewelryColors.appendChild(li);
    });
}

/* RGB To HEX */

function rgbToHex(r, g, b) {

    return "#" +
        [r, g, b]
            .map(x => {
                const hex = x.toString(16);
                return hex.length === 1 ? "0" + hex : hex;
            })
            .join("");
}