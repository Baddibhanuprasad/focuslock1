const axios = require('axios');

class RoadmapGenerator {
  // Built-in verified high-quality free and paid resources dictionary for link enrichment
  getCuratedDatabase() {
    return {
      "data analysis": [
        { name: "Google Data Analytics Professional Certificate", url: "https://www.coursera.org/professional-certificates/google-data-analytics", type: "paid", hasCertificate: true, resumeWeight: "High" },
        { name: "freeCodeCamp Data Analysis with Python", url: "https://www.freecodecamp.org/learn/data-analysis-with-python/", type: "free", hasCertificate: true, resumeWeight: "Medium" },
        { name: "Kaggle Learn Data Science & Python", url: "https://www.kaggle.com/learn", type: "free", hasCertificate: true, resumeWeight: "Medium" },
        { name: "IBM Data Analyst Professional Certificate", url: "https://www.coursera.org/professional-certificates/ibm-data-analyst", type: "paid", hasCertificate: true, resumeWeight: "High" }
      ],
      "frontend developer": [
        { name: "MDN Web Docs Front-End Web Developer", url: "https://developer.mozilla.org/en-US/docs/Learn", type: "free", hasCertificate: false, resumeWeight: "Medium" },
        { name: "freeCodeCamp Responsive Web Design & JavaScript", url: "https://www.freecodecamp.org/learn/2022/responsive-web-design/", type: "free", hasCertificate: true, resumeWeight: "Medium" },
        { name: "Meta Front-End Developer Professional Certificate", url: "https://www.coursera.org/professional-certificates/meta-front-end-developer", type: "paid", hasCertificate: true, resumeWeight: "High" },
        { name: "The Odin Project - Full Stack JavaScript", url: "https://www.theodinproject.com/", type: "free", hasCertificate: false, resumeWeight: "High" }
      ],
      "ui/ux design": [
        { name: "Google UX Design Professional Certificate", url: "https://www.coursera.org/professional-certificates/google-ux-design", type: "paid", hasCertificate: true, resumeWeight: "High" },
        { name: "Figma Official Beginner Tutorials", url: "https://help.figma.com/hc/en-us/categories/360002051613-Getting-Started", type: "free", hasCertificate: false, resumeWeight: "Medium" },
        { name: "Interaction Design Foundation Free Design Guides", url: "https://www.interaction-design.org/literature", type: "free", hasCertificate: false, resumeWeight: "Medium" },
        { name: "CalArts Graphic Design Specialization", url: "https://www.coursera.org/specializations/graphic-design", type: "paid", hasCertificate: true, resumeWeight: "High" }
      ],
      "python": [
        { name: "Python for Everybody (University of Michigan)", url: "https://www.py4e.com/", type: "free", hasCertificate: true, resumeWeight: "High" },
        { name: "Real Python Tutorials & Guides", url: "https://realpython.com/", type: "free", hasCertificate: false, resumeWeight: "Medium" },
        { name: "PCAP – Certified Associate in Python Programming", url: "https://pythoninstitute.org/pcap", type: "paid", hasCertificate: true, resumeWeight: "High" }
      ]
    };
  }

  async generateRoadmap(goalText) {
    console.log(`[RoadmapGenerator] Generating roadmap for goal: "${goalText}"`);
    let rawRoadmap = null;

    // 1. Try local Ollama LLM if present
    try {
      const prompt = `You are a career curriculum expert. Generate a structured 4-stage learning roadmap for learning: "${goalText}".
Format ONLY valid JSON with no extra text or markdown code blocks:
{
  "goal": "${goalText}",
  "stages": [
    {
      "title": "Stage 1: Fundamentals",
      "description": "Core concepts and setup",
      "resources": [
        { "name": "Resource Name", "url": "https://example.com", "type": "free", "hasCertificate": true, "description": "Brief description" }
      ]
    }
  ]
}
Rule: Place free resources and free certs in earlier stages, and high-value paid resume certifications in later stages.`;

      const response = await axios.post('http://localhost:11434/api/generate', {
        model: 'llama3.1:8b',
        prompt: prompt,
        stream: false
      }, { timeout: 3000 });

      const text = response.data?.response;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        rawRoadmap = JSON.parse(jsonMatch[0]);
      }
    } catch (err) {
      console.log('[RoadmapGenerator] Ollama not active. Utilizing intelligent domain roadmap generator fallback.');
    }

    // Fallback roadmap engine if Ollama is not active
    if (!rawRoadmap || !rawRoadmap.stages) {
      rawRoadmap = this.generateFallbackRoadmap(goalText);
    }

    // 2. Enrich with verified real clickable links
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
          title: "Stage 1: Core Fundamentals & Foundations",
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
          title: "Stage 2: Intermediate Projects & Tools",
          description: "Apply concepts by building practical real-world portfolio projects.",
          resources: [
            {
              name: `Kaggle / GitHub Hands-on Labs & Repositories`,
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
              badgeLabel: "Free Audit + Cert Option"
            }
          ]
        },
        {
          stageNumber: 3,
          title: "Stage 3: Advanced Specialization & Paid Certifications",
          description: "Gain industry-recognized credentials to boost your resume.",
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
        },
        {
          stageNumber: 4,
          title: "Stage 4: Portfolio Polish & Interview Prep",
          description: "Prepare case studies, GitHub repositories, and practice technical challenges.",
          resources: [
            {
              name: "LeetCode & System Design / Portfolio Practice",
              url: "https://leetcode.com/",
              type: "free",
              hasCertificate: false,
              resumeWeight: "High",
              badgeLabel: "Free Practice"
            }
          ]
        }
      ]
    };
  }

  enrichWithRealLinks(goalText, roadmap) {
    const curatedDb = this.getCuratedDatabase();
    const cleanGoal = goalText.toLowerCase();

    // Check if we have exact curated matches
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

      if (roadmap.stages[2]) {
        roadmap.stages[2].resources = paidItems.map(item => ({
          ...item,
          badgeLabel: "Boosts Resume"
        }));
      }
    }

    return roadmap;
  }
}

module.exports = new RoadmapGenerator();
