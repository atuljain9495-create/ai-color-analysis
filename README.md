# AI Color Analysis 🎨✨

An advanced, privacy-first, browser-based seasonal color analysis application. This tool leverages client-side computer vision to track facial matrices and determine a user's skin tone, undertone, and seasonal type (e.g., Deep Winter, Warm Spring) without sending any private photo data to a server.

🔗 **Live Application:** [https://aicoloranalysis.online](https://aicoloranalysis.online)

---

## 🚀 Core Features

* **Dual-Engine Face Tracking:** Utilizes `face-api.js` (TinyFaceDetector) with an automatic native browser `FaceDetector` fallback wrapper to isolate cheek and forehead regions dynamically.
* **Intelligent Skin Filter:** Employs an adaptive rule-based pixel heuristic that screens out deep shadows, background clutter, hair strands, and intense lighting glare.
* **Comprehensive Seasonal Engine:** Maps user metrics across **12 structural seasonal subtypes** to generate instant recommendations for:
  * **Clothing:** Optimal capsule palettes (Best, Good, and shades to Avoid).
  * **Hair Styling:** Complementary hair dye tones (Ash, Golden, Coppery, etc.).
  * **Jewelry Finishes:** Metallic matching preferences (Gold, Silver, Platinum, Rose Gold).
* **100% Privacy Secure:** Operates entirely client-side. Images and live camera streams are processed locally in temporary device RAM cache and erased permanently on page refresh.
* **SEO Optimized Blog Structure:** Fully broken down into 10 separate standalone micro-pages targeting competitive keywords like skin undertones, face lighting precision, and capsule wardrobe design.
* **Responsive Interactive UI:** Features native accordion-style FAQs, an immediate GDPR cookie consent barrier, and a global, high-contrast Dark Mode toggle.

---

## 🛠️ Tech Stack & Architecture

* **Frontend:** Semantic HTML5, CSS Custom Properties (Theme Variables)
* **Logic & Tracking:** Vanilla JavaScript (ES6+ Async/Await), `face-api.js`
* **Infrastructure:** GitHub Actions, GitHub Pages Deployment Framework
* **SEO & Analytics:** Google Analytics 4 (GA4 Standard Stream Integration), Google Search Console mapping, XML Sitemaps indexation.

---
💻 Local Quickstart
To run and experiment with this application on your local machine, you do not need any complex compiler dependencies.

Clone the repository:

Bash
   git clone [https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git](https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git)
   cd YOUR_REPO_NAME
Launch a local server context:
Because browser security models restrict local file camera operations (file://), launch a basic local development server environment:

Bash
   # If you have Python installed:
   python -m http.server 8000
   
   # Or using Node.js:
   npx serve .
Open the browser:
Navigate to http://localhost:8000 to interact with your local setup.

🛡️ License & Legal Framework
Distributed under the MIT License. See terms.html and privacy.html for extended disclaimer structures regarding third-party ad frameworks (Google AdSense) and cookie metrics tracking rules.
## 📁 Repository Directory Structure

```text
├── index.html                           # Main interactive tracking application
├── blog.html                            # Main SEO hub listing directory 
├── blog-skin-undertone.html              # Standalone article: Finding undertones
├── blog-warm-undertones.html            # Standalone article: Warm wardrobe guide
├── blog-cool-undertones.html            # Standalone article: Cool wardrobe guide
├── blog-seasonal-analysis-explained.html # Standalone article: Seasonal frameworks
├── blog-how-ai-color-analysis-works.html # Standalone article: Architecture breakdown
├── blog-hair-color-skin-tones.html      # Standalone article: Hair shade guides
├── blog-gold-vs-silver-jewelry.html     # Standalone article: Metallic harmonies
├── blog-common-color-mistakes.html      # Standalone article: Fashion pitfalls
├── blog-why-lighting-matters.html       # Standalone article: Photography precision
├── blog-building-a-color-wardrobe.html  # Standalone article: Capsule outfitting
├── About.html                           # Platform vision page
├── contact.html                         # Customer plain-English inquiry channel
├── privacy.html                         # AdSense & GDPR compliant privacy policy
├── terms.html                           # Terms of service and disclaimers
├── style.css                            # Global theme custom variable stylesheet
├── app.js                               # Computer vision logic and image processors
├── sitemap.xml                          # Google index parsing map layout
└── robots.txt                           # Web crawler allowance parameter
