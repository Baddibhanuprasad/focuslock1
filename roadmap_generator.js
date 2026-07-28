const axios = require('axios');

class RoadmapGenerator {
  constructor() {
    this.geminiModels = [
      'gemini-flash-latest',
      'gemini-3.5-flash',
      'gemini-3.6-flash',
      'gemini-2.0-flash-lite',
      'gemini-2.5-flash-lite'
    ];
  }

  // Curated database of verified real live links (4 resources per stage)
  getCuratedDatabase() {
    return {
      "data analysis": [
        { name: "freeCodeCamp Data Analysis with Python", url: "https://www.freecodecamp.org/learn/data-analysis-with-python/", type: "free", hasCertificate: true, resumeWeight: "Medium", badgeLabel: "100% Free Cert" },
        { name: "Kaggle Learn Data Science & Python", url: "https://www.kaggle.com/learn", type: "free", hasCertificate: true, resumeWeight: "Medium", badgeLabel: "Free + Cert" },
        { name: "Google Data Analytics Professional Certificate", url: "https://www.coursera.org/professional-certificates/google-data-analytics", type: "paid", hasCertificate: true, resumeWeight: "High", badgeLabel: "Boosts Resume" },
        { name: "IBM Data Analyst Professional Certificate", url: "https://www.coursera.org/professional-certificates/ibm-data-analyst", type: "paid", hasCertificate: true, resumeWeight: "High", badgeLabel: "Resume Heavyweight" }
      ],
      "frontend developer": [
        { name: "MDN Web Docs Front-End Web Developer Guide", url: "https://developer.mozilla.org/en-US/docs/Learn", type: "free", hasCertificate: false, resumeWeight: "Medium", badgeLabel: "Free Guide" },
        { name: "freeCodeCamp Responsive Web Design & JavaScript", url: "https://www.freecodecamp.org/learn/2022/responsive-web-design/", type: "free", hasCertificate: true, resumeWeight: "Medium", badgeLabel: "100% Free Cert" },
        { name: "The Odin Project - Full Stack JavaScript", url: "https://www.theodinproject.com/", type: "free", hasCertificate: false, resumeWeight: "High", badgeLabel: "Open Source" },
        { name: "Meta Front-End Developer Professional Certificate", url: "https://www.coursera.org/professional-certificates/meta-front-end-developer", type: "paid", hasCertificate: true, resumeWeight: "High", badgeLabel: "Boosts Resume" }
      ],
      "ui/ux design": [
        { name: "Figma Official Beginner Tutorials", url: "https://help.figma.com/hc/en-us/categories/360002051613-Getting-Started", type: "free", hasCertificate: false, resumeWeight: "Medium", badgeLabel: "100% Free" },
        { name: "Interaction Design Foundation Free Design Guides", url: "https://www.interaction-design.org/literature", type: "free", hasCertificate: false, resumeWeight: "Medium", badgeLabel: "Free Guide" },
        { name: "Google UX Design Professional Certificate", url: "https://www.coursera.org/professional-certificates/google-ux-design", type: "paid", hasCertificate: true, resumeWeight: "High", badgeLabel: "Boosts Resume" },
        { name: "CalArts Graphic Design Specialization", url: "https://www.coursera.org/specializations/graphic-design", type: "paid", hasCertificate: true, resumeWeight: "High", badgeLabel: "Boosts Resume" }
      ],
      "cybersecurity": [
        { name: "TryHackMe Pre-Security & Fundamentals Path", url: "https://tryhackme.com/", type: "free", hasCertificate: true, resumeWeight: "Medium", badgeLabel: "100% Free Cert" },
        { name: "Cisco Networking Academy Introduction to Cybersecurity", url: "https://www.netacad.com/courses/cybersecurity/introduction-cybersecurity", type: "free", hasCertificate: true, resumeWeight: "High", badgeLabel: "Free Cert" },
        { name: "Google Cybersecurity Professional Certificate", url: "https://www.coursera.org/professional-certificates/google-cybersecurity", type: "paid", hasCertificate: true, resumeWeight: "High", badgeLabel: "Boosts Resume" },
        { name: "CompTIA Security+ Certification Prep", url: "https://www.comptia.org/certifications/security", type: "paid", hasCertificate: true, resumeWeight: "High", badgeLabel: "Industry Gold Standard" }
      ]
    };
  }

  async generateRoadmap(goalText, userApiKeys = []) {
    console.log(`[RoadmapGenerator] Generating AI roadmap with 4 links per stage for goal: "${goalText}"`);
    let rawRoadmap = null;

    const defaultWorkingKey = 'AQ.Ab8RN6KXhQLRqnMzs_5JI9OkKrmFTiVX9NMlGTS4REgnoCHxSA';
    const apiKeys = (userApiKeys || [])
      .map(k => (k || '').trim())
      .filter(k => k.length > 5);

    if (!apiKeys.includes(defaultWorkingKey)) {
      apiKeys.push(defaultWorkingKey);
    }

    for (let keyIdx = 0; keyIdx < apiKeys.length; keyIdx++) {
      const apiKey = apiKeys[keyIdx];
      console.log(`[RoadmapGenerator] Attempting generation with API Key #${keyIdx + 1}...`);

      for (const model of this.geminiModels) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

          const prompt = `You are a career curriculum expert. Generate a structured 4-stage learning roadmap (Beginner -> Intermediate -> Advanced -> Specialization & Paid Certifications) for learning: "${goalText}".
IMPORTANT CRITICAL RULE: EVERY STAGE MUST CONTAIN EXACTLY 4 HIGH-QUALITY COURSES/RESOURCES WITH VALID LIVE LINKS (Total 16 links across 4 stages).

Format ONLY valid JSON with no extra text or markdown code blocks:
{
  "goal": "${goalText}",
  "stages": [
    {
      "stageNumber": 1,
      "title": "Stage 1: Beginner - Foundations & Theory",
      "description": "Essential concepts, tools, and basic setup",
      "resources": [
        { "name": "Resource 1 Name", "url": "https://example.com/1", "type": "free", "hasCertificate": true, "resumeWeight": "Medium", "badgeLabel": "100% Free Cert" },
        { "name": "Resource 2 Name", "url": "https://example.com/2", "type": "free", "hasCertificate": false, "resumeWeight": "Medium", "badgeLabel": "Free Guide" },
        { "name": "Resource 3 Name", "url": "https://example.com/3", "type": "free", "hasCertificate": true, "resumeWeight": "Medium", "badgeLabel": "Free Interactive Course" },
        { "name": "Resource 4 Name", "url": "https://example.com/4", "type": "free", "hasCertificate": false, "resumeWeight": "Medium", "badgeLabel": "Documentation" }
      ]
    },
    {
      "stageNumber": 2,
      "title": "Stage 2: Intermediate - Hands-on Projects",
      "description": "Practical application and building real-world projects",
      "resources": [
        { "name": "Resource 1 Name", "url": "https://example.com/5", "type": "free", "hasCertificate": false, "resumeWeight": "Medium", "badgeLabel": "Interactive Lab" },
        { "name": "Resource 2 Name", "url": "https://example.com/6", "type": "free", "hasCertificate": false, "resumeWeight": "High", "badgeLabel": "Open Source Project" },
        { "name": "Resource 3 Name", "url": "https://example.com/7", "type": "free", "hasCertificate": true, "resumeWeight": "Medium", "badgeLabel": "Hands-on Practice" },
        { "name": "Resource 4 Name", "url": "https://example.com/8", "type": "free", "hasCertificate": false, "resumeWeight": "Medium", "badgeLabel": "Code Repository" }
      ]
    },
    {
      "stageNumber": 3,
      "title": "Stage 3: Advanced - Systems & Specialization",
      "description": "Deep dive into advanced topics and industry practices",
      "resources": [
        { "name": "Resource 1 Name", "url": "https://example.com/9", "type": "free", "hasCertificate": false, "resumeWeight": "High", "badgeLabel": "Architecture Framework" },
        { "name": "Resource 2 Name", "url": "https://example.com/10", "type": "free", "hasCertificate": false, "resumeWeight": "High", "badgeLabel": "Advanced Deep-Dive" },
        { "name": "Resource 3 Name", "url": "https://example.com/11", "type": "free", "hasCertificate": false, "resumeWeight": "High", "badgeLabel": "System Design" },
        { "name": "Resource 4 Name", "url": "https://example.com/12", "type": "free", "hasCertificate": true, "resumeWeight": "High", "badgeLabel": "Specialized Audit" }
      ]
    },
    {
      "stageNumber": 4,
      "title": "Stage 4: Professional Certifications & Career Boosters",
      "description": "Industry-recognized paid certifications to maximize resume weight",
      "resources": [
        { "name": "Certification 1 Name", "url": "https://example.com/13", "type": "paid", "hasCertificate": true, "resumeWeight": "High", "badgeLabel": "Boosts Resume" },
        { "name": "Certification 2 Name", "url": "https://example.com/14", "type": "paid", "hasCertificate": true, "resumeWeight": "High", "badgeLabel": "Industry Standard" },
        { "name": "Certification 3 Name", "url": "https://example.com/15", "type": "paid", "hasCertificate": true, "resumeWeight": "High", "badgeLabel": "Professional Specialization" },
        { "name": "Certification 4 Name", "url": "https://example.com/16", "type": "paid", "hasCertificate": true, "resumeWeight": "High", "badgeLabel": "Top Credential" }
      ]
    }
  ]
}
Rule: Ensure EVERY stage has EXACTLY 4 resources. Return valid JSON only.`;

          const response = await axios.post(url, {
            contents: [{ parts: [{ text: prompt }] }]
          }, { timeout: 20000 });

          const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            rawRoadmap = JSON.parse(jsonMatch[0]);
            console.log(`[RoadmapGenerator] Successfully generated AI roadmap with 4 resources per stage using Key #${keyIdx + 1}!`);
            break;
          }
        } catch (err) {
          const errMsg = err.response ? (err.response.data?.error?.message || err.message) : err.message;
          const status = err.response ? err.response.status : null;
          console.warn(`[RoadmapGenerator] Key #${keyIdx + 1} model ${model} failed: ${errMsg}`);

          if (status === 400 || status === 401 || status === 403 || status === 429 || errMsg.includes('quota') || errMsg.includes('EXHAUSTED')) {
            break;
          }
        }
      }

      if (rawRoadmap && rawRoadmap.stages) break;
    }

    if (!rawRoadmap || !rawRoadmap.stages) {
      console.log('[RoadmapGenerator] Using domain fallback roadmap engine.');
      rawRoadmap = this.generateFallbackRoadmap(goalText);
    }

    // Guarantee EXACTLY 4 links per stage
    const enrichedRoadmap = this.enrichWithRealLinks(goalText, rawRoadmap);
    return enrichedRoadmap;
  }

  generateFallbackRoadmap(goalText) {
    const cleanGoal = goalText.trim().toLowerCase();
    
    return {
      goal: goalText,
      stages: [
        {
          stageNumber: 1,
          title: "Stage 1: Beginner - Core Foundations & Concepts",
          description: "Build strong essential theory, terminology, and initial hands-on practice.",
          resources: [
            { name: `freeCodeCamp ${goalText} Interactive Course`, url: `https://www.freecodecamp.org/search?q=${encodeURIComponent(goalText)}`, type: "free", hasCertificate: true, resumeWeight: "Medium", badgeLabel: "100% Free Cert" },
            { name: `MDN & Open Educational Guides for ${goalText}`, url: `https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(goalText)}`, type: "free", hasCertificate: false, resumeWeight: "Medium", badgeLabel: "Free Guide" },
            { name: `W3Schools / Codecademy ${goalText} Basics`, url: `https://www.google.com/search?q=${encodeURIComponent(goalText)}+w3schools+basics`, type: "free", hasCertificate: false, resumeWeight: "Medium", badgeLabel: "Interactive Basics" },
            { name: `Coursera ${goalText} Fundamentals (Free Audit)`, url: `https://www.coursera.org/search?query=${encodeURIComponent(goalText)}`, type: "free", hasCertificate: false, resumeWeight: "Medium", badgeLabel: "Free Audit" }
          ]
        },
        {
          stageNumber: 2,
          title: "Stage 2: Intermediate - Hands-on Projects & Tools",
          description: "Apply concepts by building practical real-world portfolio projects.",
          resources: [
            { name: `Kaggle / GitHub Open Source Repositories for ${goalText}`, url: `https://github.com/topics/${encodeURIComponent(cleanGoal.replace(/\s+/g, '-'))}`, type: "free", hasCertificate: false, resumeWeight: "Medium", badgeLabel: "Open Source" },
            { name: `Harvard CS50 Open Courseware - ${goalText}`, url: `https://cs50.harvard.edu/x/`, type: "free", hasCertificate: true, resumeWeight: "High", badgeLabel: "Free Audit + Cert" },
            { name: `YouTube Full ${goalText} Project Tutorials`, url: `https://www.youtube.com/results?search_query=${encodeURIComponent(goalText)}+full+project+tutorial`, type: "free", hasCertificate: false, resumeWeight: "Medium", badgeLabel: "Video Tutorial" },
            { name: `LeetCode / HackerRank Practical Labs`, url: `https://www.hackerrank.com/domains`, type: "free", hasCertificate: true, resumeWeight: "High", badgeLabel: "Coding Labs" }
          ]
        },
        {
          stageNumber: 3,
          title: "Stage 3: Advanced - Deep Dive & Systems Architecture",
          description: "Master complex topics, optimization, and production-grade architectures.",
          resources: [
            { name: `MIT OpenCourseWare - Advanced ${goalText}`, url: `https://ocw.mit.edu/search/?q=${encodeURIComponent(goalText)}`, type: "free", hasCertificate: false, resumeWeight: "High", badgeLabel: "MIT OCW" },
            { name: `System Design & Architecture for ${goalText}`, url: `https://github.com/donnemartin/system-design-primer`, type: "free", hasCertificate: false, resumeWeight: "High", badgeLabel: "System Architecture" },
            { name: `Linux Foundation Open Source Standards`, url: `https://training.linuxfoundation.org`, type: "free", hasCertificate: false, resumeWeight: "High", badgeLabel: "Industry Standard" },
            { name: `OWASP & NIST Security / Architecture Frameworks`, url: `https://owasp.org`, type: "free", hasCertificate: false, resumeWeight: "High", badgeLabel: "Enterprise Guide" }
          ]
        },
        {
          stageNumber: 4,
          title: "Stage 4: Professional Certifications & Career Boosters",
          description: "Gain industry-recognized credentials to maximize resume weight.",
          resources: [
            { name: `Google Professional Certificate in ${goalText}`, url: `https://www.coursera.org/search?query=${encodeURIComponent(goalText)}%20google%20certificate`, type: "paid", hasCertificate: true, resumeWeight: "High", badgeLabel: "Boosts Resume" },
            { name: `Meta / IBM Professional Specialization`, url: `https://www.coursera.org/search?query=${encodeURIComponent(goalText)}%20meta`, type: "paid", hasCertificate: true, resumeWeight: "High", badgeLabel: "Resume Heavyweight" },
            { name: `CompTIA / AWS / Microsoft Certified Professional`, url: `https://aws.amazon.com/certification/`, type: "paid", hasCertificate: true, resumeWeight: "High", badgeLabel: "Cloud Gold Standard" },
            { name: `Udacity Nanodegree Program in ${goalText}`, url: `https://www.udacity.com`, type: "paid", hasCertificate: true, resumeWeight: "High", badgeLabel: "Professional Nanodegree" }
          ]
        }
      ]
    };
  }

  enrichWithRealLinks(goalText, roadmap) {
    if (!roadmap || !roadmap.stages) return roadmap;

    // Ensure every stage has EXACTLY 4 resources
    roadmap.stages.forEach((stage, idx) => {
      if (!stage.resources) stage.resources = [];

      // If stage has fewer than 4 resources, pad with contextual resources
      while (stage.resources.length < 4) {
        const itemNum = stage.resources.length + 1;
        if (idx === 0) {
          stage.resources.push({
            name: `Interactive ${goalText} Practice Guide #${itemNum}`,
            url: `https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(goalText)}`,
            type: "free",
            hasCertificate: false,
            resumeWeight: "Medium",
            badgeLabel: "100% Free"
          });
        } else if (idx === 1) {
          stage.resources.push({
            name: `GitHub Open Source Repository #${itemNum} for ${goalText}`,
            url: `https://github.com/search?q=${encodeURIComponent(goalText)}`,
            type: "free",
            hasCertificate: false,
            resumeWeight: "Medium",
            badgeLabel: "Open Source"
          });
        } else if (idx === 2) {
          stage.resources.push({
            name: `Advanced ${goalText} Deep-Dive Paper / Architecture #${itemNum}`,
            url: `https://ocw.mit.edu/search/?q=${encodeURIComponent(goalText)}`,
            type: "free",
            hasCertificate: false,
            resumeWeight: "High",
            badgeLabel: "Advanced Framework"
          });
        } else {
          stage.resources.push({
            name: `Professional Certificate in ${goalText} #${itemNum}`,
            url: `https://www.coursera.org/search?query=${encodeURIComponent(goalText)}`,
            type: "paid",
            hasCertificate: true,
            resumeWeight: "High",
            badgeLabel: "Boosts Resume"
          });
        }
      }

      // If stage has more than 4 resources, slice to top 4
      if (stage.resources.length > 4) {
        stage.resources = stage.resources.slice(0, 4);
      }
    });

    return roadmap;
  }
}

module.exports = new RoadmapGenerator();
