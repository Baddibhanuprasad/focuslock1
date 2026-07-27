const axios = require('axios');

async function testGemini() {
  const apiKey = 'AQ.Ab8RN6KXhQLRqnMzs_5JI9OkKrmFTiVX9NMlGTS4REgnoCHxSA';
  
  const modelsToTry = [
    'gemini-flash-latest',
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-2.0-flash-lite'
  ];

  const prompt = `You are a career curriculum expert. Generate a structured 4-stage learning roadmap (Stage 1: Beginner, Stage 2: Intermediate, Stage 3: Advanced, Stage 4: Specialization & Paid Certifications) for learning: "Cybersecurity".
Return ONLY valid JSON matching this exact structure:
{
  "goal": "Cybersecurity",
  "stages": [
    {
      "stageNumber": 1,
      "title": "Stage 1: Beginner - Foundations",
      "description": "Core concepts and basic setup",
      "resources": [
        {
          "name": "TryHackMe Pre-Security Path",
          "url": "https://tryhackme.com",
          "type": "free",
          "hasCertificate": true,
          "resumeWeight": "Medium",
          "badgeLabel": "100% Free"
        }
      ]
    }
  ]
}`;

  for (const model of modelsToTry) {
    try {
      console.log(`Trying model: ${model}...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await axios.post(url, {
        contents: [{ parts: [{ text: prompt }] }]
      });

      const text = res.data.candidates[0].content.parts[0].text;
      console.log(`=== SUCCESS WITH ${model} ===`);
      console.log(text.substring(0, 300));
      return;
    } catch (err) {
      console.log(`Model ${model} failed:`, err.response ? err.response.data.error.message : err.message);
    }
  }
}

testGemini();
