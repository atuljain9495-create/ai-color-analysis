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
const genderSelect   = document.getElementById("genderSelect");

let uploadedImage     = null;
let stream            = null;
let currentFacingMode = "user";
let faceDetector      = null;
let faceApiReady      = false;
let faceApiFailed     = false;
let ageGenderReady    = false;

// Global memory state tracking arrays for individual card color slider positions
let itemsToShopMatrix = [];

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
    if (hairColors)     hairColors.innerHTML = "";
    if (jewelryColors)  jewelryColors.innerHTML = "";
    if (shopGrid)       shopGrid.innerHTML = "";
    if (shopSection)    shopSection.style.display = "none";
    if (genderResult)   genderResult.style.display = "none";
}

function resetResults() {
    if (skinToneDiv)    skinToneDiv.innerHTML = "Waiting for analysis...";
    if (hexColorDiv)    hexColorDiv.innerHTML = "";
    if (undertoneDiv)   undertoneDiv.innerHTML = "";
    if (seasonalTypeDiv)seasonalTypeDiv.innerHTML = "";
    if (confidenceScore)confidenceScore.innerHTML = "";
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
    if (img.width < 150 || img.height < 150) throw new Error("Image resolution too low. Please use a clearer photo.");
    if (brightness < 45)  throw new Error("Photo is too dark. Move closer to a window or turn on a light.");
    if (brightness > 240) throw new Error("Photo is overexposed. Avoid direct flash or harsh lighting.");
    const contrastLevel = getContrastLevel(data);
    await initFaceApi();
    const faceData = await detectFaceData(img);
    return { brightness, contrastLevel, ...faceData };
}

if (localStorage.getItem("darkMode") === "true") document.body.classList.add("dark-mode");
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
            setValidationMessage("Photo uploaded. Ready to analyse.", "info");
        };
        reader.readAsDataURL(file);
    });
}

async function openCamera() {
    try {
        if (!navigator.mediaDevices) { alert("Camera not accessible. Ensure HTTPS."); return; }
        if (stream) stream.getTracks().forEach(t => t.stop());
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: currentFacingMode } }, audio: false });
        video.srcObject = stream;
        if (cameraWrapper) cameraWrapper.style.display = "flex";
        video.style.display = "block";
        if (captureBtn) captureBtn.style.display = "inline-block";
        setStatus(`Camera ready (${currentFacingMode === "user" ? "selfie" : "back"} camera).`, "info");
    } catch (e) { setStatus("Could not start camera. Use file upload instead.", "error"); }
}

if (cameraBtn)       cameraBtn.addEventListener("click", openCamera);
if (cameraSwitchBtn) cameraSwitchBtn.addEventListener("click", () => { currentFacingMode = currentFacingMode === "user" ? "environment" : "user"; openCamera(); });

if (captureBtn) {
    captureBtn.addEventListener("click", () => {
        if (!video.videoWidth) { setStatus("Camera warming up. Try again.", "error"); return; }
        canvas.width=video.videoWidth; canvas.height=video.videoHeight;
        canvas.getContext("2d").drawImage(video,0,0,canvas.width,canvas.height);
        uploadedImage = canvas.toDataURL("image/png");
        previewImage.src=uploadedImage; previewImage.style.display="block";
        previewWrapper.style.display="flex";
        setStatus("Photo captured!", "success");
        if (stream) { stream.getTracks().forEach(t=>t.stop()); stream=null; }
        video.style.display="none"; captureBtn.style.display="none";
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

function analyzeSkinTone(imageSrc, validationResult = {}) {
    const img = new Image();
    img.onload = function () {
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

        const hex=rgbToHex(r,g,b);
        const brightness=(r+g+b)/3;
        const confidencePercent=Math.min(100,Math.max(45,Math.round((count/(sampleWidth*sampleHeight))*100)));

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

        // ── FIXED ENGINES: RESOLVING DETECTED ATTRIBUTES ──
        const detectedGender=validationResult.gender||null;
        const detectedAge=validationResult.age||null;
        const genderProb=validationResult.genderProb||0;

        const selectedDropdownMode = genderSelect ? genderSelect.value : "auto";
        let personType = "woman"; // Standard clean default base

        // 1. If the user explicitly chose Men, Women, or Child in the dropdown, obey it instantly!
        if (selectedDropdownMode !== "auto") {
            personType = selectedDropdownMode;
        } 
        // 2. If it's on Auto, use the live face-api.js AI tracking metrics safely if they loaded
        else if (detectedGender) {
            if (detectedGender === "male") personType = "man";
            if (detectedGender === "female") personType = "woman";
            if (detectedAge !== null && detectedAge < 13) personType = "child";
        } 
        // 3. Smart Context Scan: If AI is processing, scan the uploaded file name for clear clues
        else {
            const fileNameLower = imageUpload && imageUpload.files[0] ? imageUpload.files[0].name.toLowerCase() : "";
            
            if (fileNameLower.includes("man") || fileNameLower.includes("male") || fileNameLower.includes("boy") || fileNameLower.includes("guy") || fileNameLower.includes("he")) {
                personType = "man";
            } else if (fileNameLower.includes("child") || fileNameLower.includes("kid") || fileNameLower.includes("baby") || fileNameLower.includes("girl") && fileNameLower.includes("kid")) {
                personType = "child";
            } else {
                personType = "woman"; // Safe balanced baseline to keep ladies' profiles secure
            }
        }

        // Standardize internal string mapping values
        if (personType === "male") personType = "man";
        if (personType === "female") personType = "woman";

        // Render demographic layout box if information is verified
        if (genderResult) {
            genderResult.style.display="flex";
            const icons={man:"👨",woman:"👩",child:"🧒"};
            const labels={
                man:   `Target Selection: <strong>Man</strong>${detectedAge?` · Approx. age ${detectedAge}`:""}`,
                woman: `Target Selection: <strong>Woman</strong>${detectedAge?` · Approx. age ${detectedAge}`:""}`,
                child: `Target Selection: <strong>Child</strong>${detectedAge?` · Approx. age ${detectedAge}`:""}`
            };
            
            genderIcon.textContent=icons[personType] || "👤";
            
            if (selectedDropdownMode !== "auto") {
                genderText.innerHTML=labels[personType] + ` <span style="opacity:0.5;font-size:0.78rem;">(Manual Filter Override)</span>`;
            } else if (detectedGender) {
                genderText.innerHTML=labels[personType] + ` <span style="opacity:0.5;font-size:0.78rem;">(${Math.round(genderProb*100)}% AI confidence)</span>`;
            } else {
                genderText.innerHTML=labels[personType] + ` <span style="opacity:0.5;font-size:0.78rem;">(Smart Fallback Mode)</span>`;
            }
        }

        skinToneDiv.innerHTML    =`<strong>Skin Tone:</strong> ${skinTone}`;
        hexColorDiv.innerHTML    =`<strong>Detected HEX:</strong> ${hex}<div style="width:72px;height:72px;background:${hex};border-radius:10px;margin-top:8px;border:2px solid #ddd;"></div>`;
        undertoneDiv.innerHTML   =`<strong>Undertone:</strong> ${undertone}`;
        seasonalTypeDiv.innerHTML=`<strong>Seasonal Type:</strong> ${seasonalType}`;
        confidenceScore.innerHTML=`<strong>Detection Confidence:</strong> ${confidencePercent}%`;

        setStatus("Analysis complete.","success");
        setValidationMessage("Your personalised colour palette is ready below.","success");

        generateRecommendations(undertone,skinToneCategory,contrastLevel);
        generateShoppingLinks(undertone,skinToneCategory,personType);
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

/* ==========================================================================
   DYNAMIC ATTRIBUTE PALETTE COLOR SLIDER CARD BUILDER
   ========================================================================== */
function generateShoppingLinks(undertone, skinToneCategory, personType) {
    if (!shopSection || !shopGrid) return;

    // 1. Gather all calculated color profile tracks securely from the engine
    const palette = getClothingPalette(undertone, skinToneCategory, "medium");
    const hair = getHairPalette(undertone, skinToneCategory);
    const jewelry = getJewelryPalette(undertone, skinToneCategory);

    // Merge Best, Good, and Accent list configurations together so NO colors are forgotten!
    const dynamicClothingColors = [...(palette.best || []), ...(palette.good || []), ...(palette.accent || [])];
    const dynamicNeutralColors  = palette.neutrals || ["Grey", "Beige", "Navy"];
    const metallicHardware      = jewelry.best || ["Gold", "Silver"];
    const crystalGemstones      = jewelry.gems || ["Pearl", "Sapphire"];
    const hairTones             = hair.best || ["Natural Brown"];

    const isMen = personType === "man" || personType === "male";
    const isChild = personType === "child";
    const prefix = isMen ? "mens " : (isChild ? "kids " : "womens ");

    // 2. Map structural color lists dynamically into independent card slider configurations
    itemsToShopMatrix = [
        { id: 0, tag: "👚 Core Tops",       type: isMen ? "shirt" : (isChild ? "tshirt" : "blouse"),    colors: dynamicClothingColors, activeIdx: 0 },
        { id: 1, tag: "👖 Bottom Staples",  type: isMen ? "trousers" : (isChild ? "pants" : "skirt"),   colors: dynamicNeutralColors,  activeIdx: 0 },
        { id: 2, tag: "🧥 Outer Layers",    type: isMen ? "jacket" : (isChild ? "hoodie" : "blazer"),   colors: dynamicClothingColors, activeIdx: 1 }, 
        { id: 3, tag: "👜 Accent Gear",     type: isMen ? "belt" : (isChild ? "backpack" : "handbag"),  colors: dynamicNeutralColors,  activeIdx: 1 },
        { id: 4, tag: "🧣 Seasonal Layers", type: "scarf",                                              colors: dynamicClothingColors, activeIdx: 2 },
        { id: 5, tag: "💍 Metallic Links",   type: "necklace",                                           colors: metallicHardware,      activeIdx: 0 },
        { id: 6, tag: "💎 Gem Accents",     type: "earrings",                                           colors: crystalGemstones,      activeIdx: 0 },
        { id: 7, tag: "💇 Hair Tones",       type: "hair dye",                                           colors: hairTones,             activeIdx: 0 }
    ];

    buildSliderCards(prefix);
    shopSection.style.display = "block";
}

/* ── INTERACTIVE CONTROLLER: DRAWING CARD LAYER VIEWS ── */
function buildSliderCards(prefix) {
    if (!shopGrid) return;
    shopGrid.innerHTML = "";

    itemsToShopMatrix.forEach((card) => {
        const currentColor = card.colors[card.activeIdx] || "Universal Base";
        
        // Escape characters safely into the URL tracking search queries
        const targetSearch = encodeURIComponent(`${currentColor} ${prefix}${card.type}`);

        const cardElement = document.createElement("div");
        cardElement.className = "shop-card";
        cardElement.innerHTML = `
            <div>
                <span class="shop-tag">${card.tag}</span>
                <div class="shop-item">${capitalise(currentColor)} ${capitalise(card.type)}</div>
            </div>
            
            <!-- INTERACTIVE SLIDER BAR NAVIGATION LAYOUT -->
            <div class="card-slider-bar">
                <button class="slider-arrow-btn" onclick="slideCardColor(${card.id}, -1, '${prefix}')">◀</button>
                <div class="slider-color-txt">Color: ${capitalise(currentColor)}</div>
                <button class="slider-arrow-btn" onclick="slideCardColor(${card.id}, 1, '${prefix}')">▶</button>
            </div>

            <div class="shop-links">
                <a class="shop-link amazon" href="https://www.amazon.com/s?k=${targetSearch}&tag=aicolor-20" target="_blank" rel="noopener noreferrer">Amazon</a>
                <a class="shop-link asos"   href="https://www.asos.com/search/?q=${targetSearch}" target="_blank" rel="noopener noreferrer">ASOS</a>
                <a class="shop-link hm"     href="https://www2.hm.com/en_us/search-results.html?q=${targetSearch}" target="_blank" rel="noopener noreferrer">H&amp;M</a>
            </div>
        `;
        shopGrid.appendChild(cardElement);
    });
}

/* ── GLOBAL INTERFACE TRIGGER: COMPUTE INDEX CHANGELOG MUTATIONS ── */
window.slideCardColor = function(cardId, offset, prefix) {
    const targetItem = itemsToShopMatrix.find(c => c.id === cardId);
    if (!targetItem) return;

    // Advance index forward or backward seamlessly inside a closed loop sequence
    targetItem.activeIdx += offset;
    if (targetItem.activeIdx >= targetItem.colors.length) {
        targetItem.activeIdx = 0; // wrap to beginning
    } else if (targetItem.activeIdx < 0) {
        targetItem.activeIdx = targetItem.colors.length - 1; // wrap to ending
    }

    buildSliderCards(prefix);
};

function capitalise(str){return str.replace(/\b\w/g,c=>c.toUpperCase());}

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
    return{best:["Yellow Gold","Silver","Rose Gold — all work equally well"],gems:["Diamond","Opal","Pearl","Morganite","Jade","Moonstone","Garnet","Smoky Quartz"],secondary:["Mixed Metals","Two-tone Jewelry","Layered Gold & Silver"],avoid:["Very Neon Enamel","Overly Bright Plastic Jewelry"]};
}

function rgbToHex(r,g,b){return"#"+[r,g,b].map(x=>{const h=x.toString(16);return h.length===1?"0"+h:h;}).join("");}