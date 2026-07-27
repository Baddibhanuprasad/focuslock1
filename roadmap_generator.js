const axios = require('axios');

class RoadmapGenerator {
  constructor() {
    this.geminiApiKey = 'AQ.Ab8RN6KXhQLRqnMzs_5JI9OkKrmFTiVX9NMlGTS4REgnoCHxSA';
    this.geminiModels = [
      'gemini-flash-latest',
      'gemini-3.5-flash',
      'gemini-3.6-flash',
      'gemini-2.0-flash-lite',
      'gemini-2.5-flash-lite'
    ];
  }

  // Curated database of verified real live links for link enrichment
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
      ],
      "python": [
        { name: "Python for Everybody (University of Michigan)", url: "https://www.py4e.com/", type: "free", hasCertificate: true, resumeWeight: "High", badgeLabel: "Free Audit + Cert" },
        { name: "Real Python Tutorials & Guides", url: "https://realpython.com/", type: "free", hasCertificate: false, resumeWeight: "Medium", badgeLabel: "Free Tutorials" },
        { name: "PCAP – Certified Associate in Python Programming", url: "https://pythoninstitute.org/pcap", type: "paid", hasCertificate: true, resumeWeight: "High", badgeLabel: "Boosts Resume" }
      ]
    };
  }

  async generateRoadmap(goalText) {
    console.log(`[RoadmapGenerator] Generating Gemini AI roadmap for goal: "${goalText}"`);
    let rawRoadmap = null;

    // 1. Generate multi-stage roadmap (Beginner -> Advanced) via Gemini API Key
    for (const model of this.geminiModels) {
      try {
        console.log(`[RoadmapGenerator] Trying Gemini model: ${model}...`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiApiKey}`;

        const prompt = `You are a career curriculum expert. Generate a structured 4-stage learning roadmap (Beginner -> Intermediate -> Advanced -> Specialization & Paid Certifications) for learning: "${goalText}".
Format ONLY valid JSON with no extra text or markdown code blocks:
{
  "goal": "${goalText}",
  "stages": [
    {
      "stageNumber": 1,
      "title": "Stage 1: Beginner - Foundations & Theory",
      "description": "Essential concepts, tools, and basic setup",
      "resources": [
        {
          "name": "Resource / Course Name",
          "url": "https://example.com",
          "type": "free",
          "hasCertificate": true,
          "resumeWeight": "Medium",
          "badgeLabel": "100% Free Cert"
        }
      ]
    },
    {
      "stageNumber": 2,
      "title": "Stage 2: Intermediate - Hands-on Projects",
      "description": "Practical application and building real-world projects",
      "resources": [
        {
          "name": "Open Source / Hands-on Lab",
          "url": "https://example.com",
          "type": "free",
          "hasCertificate": false,
          "resumeWeight": "Medium",
          "badgeLabel": "Open Source"
        }
      ]
    },
    {
      "stageNumber": 3,
      "title": "Stage 3: Advanced - Systems & Specialization",
      "description": "Deep dive into advanced topics and industry practices",
      "resources": [
        {
          "name": "Advanced Specialization",
          "url": "https://example.com",
          "type": "free",
          "hasCertificate": true,
          "resumeWeight": "High",
          "badgeLabel": "Advanced Specialization"
        }
      ]
    },
    {
      "stageNumber": 4,
      "title": "Stage 4: Professional Certifications & Career Boosters",
      "description": "Industry-recognized paid certifications to maximize resume weight",
      "resources": [
        {
          "name": "Professional Certificate",
          "url": "https://example.com",
          "type": "paid",
          "hasCertificate": true,
          "resumeWeight": "High",
          "badgeLabel": "Boosts Resume"
        }
      ]
    }
  ]
}
Rule: Ensure free resources and free certs are in earlier stages (Stage 1 & 2), and paid resume-weight certifications are in Stage 4. Return valid JSON only.`;

        const response = await axios.post(url, {
          contents: [{ parts: [{ text: prompt }] }]
        }, { timeout: 20000 });

        const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          rawRoadmap = JSON.parse(jsonMatch[0]);
          console.log(`[RoadmapGenerator] Successfully generated AI roadmap with Gemini (${model})!`);
          break;
        }
      } catch (err) {
        console.warn(`[RoadmapGenerator] Gemini model ${model} warning:`, err.response ? err.response.data?.error?.message : err.message);
      }
    }

    // 2. Fallback generator if Gemini API response fails
    if (!rawRoadmap || !rawRoadmap.stages) {
      console.log('[RoadmapGenerator] Using domain fallback roadmap engine.');
      rawRoadmap = this.generateFallbackRoadmap(goalText);
    }

    // 3. Enrich with verified real clickable links
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
            {
              name: `freeCodeCamp ${goalText} Interactive Course`,
              url: `https://www.freecodecamp.org/search?q=${encodeURIComponent(goalText)}`,
              type: "free",
              hasCertificate: true,
              resumeWeight: "Medium",
              badgeLabel: "100% Free Cert"
            },
            {
              name: `MDN & Open Educational Guides for ${goalText}`,
              url: `https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(goalText)}`,
              type: "free",
              hasCertificate: false,
              resumeWeight: "Medium",
              badgeLabel: "Free Resource"
            }
          ]
        },
        {
          stageNumber: 2,
          title: "Stage 2: Intermediate - Hands-on Projects & Tools",
          description: "Apply concepts by building practical real-world portfolio projects.",
          resources: [
            {
              name: `Kaggle / GitHub Open Source Repositories for ${goalText}`,
              url: `https://github.com/topics/${encodeURIComponent(cleanGoal.replace(/\s+/g, '-'))}`,
              type: "free",
              hasCertificate: false,
              resumeWeight: "Medium",
              badgeLabel: "Open Source"
            },
            {
              name: `Harvard CS50 Open Courseware - ${goalText} Foundations`,
              url: `https://cs50.harvard.edu/x/`,
              type: "free",
              hasCertificate: true,
              resumeWeight: "High",
              badgeLabel: "Free Audit + Cert"
            }
          ]
        },
        {
          stageNumber: 3,
          title: "Stage 3: Advanced - Deep Dive & Systems Architecture",
          description: "Master complex topics, optimization, and production-grade architectures.",
          resources: [
            {
              name: `MIT OpenCourseWare - Advanced ${goalText}`,
              url: `https://ocw.mit.edu/search/?q=${encodeURIComponent(goalText)}`,
              type: "free",
              hasCertificate: false,
              resumeWeight: "High",
              badgeLabel: "MIT OCW"
            }
          ]
        },
        {
          stageNumber: 4,
          title: "Stage 4: Professional Certifications & Career Boosters",
          description: "Gain industry-recognized credentials to maximize resume weight.",
          resources: [
            {
              name: `Google Professional Certificate in ${goalText}`,
              url: `https://www.coursera.org/search?query=${encodeURIComponent(goalText)}%20google%20certificate`,
              type: "paid",
              hasCertificate: true,
              resumeWeight: "High",
              badgeLabel: "Boosts Resume"
            },
            {
              name: `Meta / IBM Professional Specialization`,
              url: `https://www.coursera.org/search?query=${encodeURIComponent(goalText)}%20meta`,
              type: "paid",
              hasCertificate: true,
              resumeWeight: "High",
              badgeLabel: "Resume Heavyweight"
            }
          ]
        }
      ]
    };
  }

  enrichWithRealLinks(goalText, roadmap) {
    const curatedDb = this.getCuratedDatabase();
    const cleanGoal = goalText.toLowerCase();

    let matchedCategory = null;
    for (const key of Object.keys(curatedDb)) {
      if (cleanGoal.includes(key)) {
        matchedCategory = key;
        break;
      }
    }

    if (matchedCategory) {
      const curatedItems = curatedDb[matchedCategory];
      const freeItems = curatedItems.filter(i => i.type === 'free');
      const paidItems = curatedItems.filter(i => i.type === 'paid');

      if (roadmap.stages[0]) {
        roadmap.stages[0].resources = freeItems.map(item => ({
          ...item,
          badgeLabel: item.hasCertificate ? "Free + Certificate" : "100% Free"
        }));
      }

      if (roadmap.stages[roadmap.stages.length - 1]) {
        roadmap.stages[roadmap.stages.length - 1].resources = paidItems.map(item => ({
          ...item,
          badgeLabel: "Boosts Resume"
        }));
      }
    }

    return roadmap;
  }
}

module.exports = new RoadmapGenerator();
