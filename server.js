try {
  const path = require('node:path');
  const fs = require('node:fs');

  for (const envPath of [
    path.join(__dirname, '.env'),
    path.resolve(__dirname, '../saint-seiya-client/.env'),
  ]) {
    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }
  }
} catch (error) {
  console.error('Failed to load environment files:', error);
}

const jsonServer = require('json-server');
const server = jsonServer.create();

const middlewares = jsonServer.defaults();
server.use(middlewares);
server.use(jsonServer.bodyParser);

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-20b';
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;

async function requestGroq(messages, responseFormat) {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured on the server.');
  }

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `Groq returned HTTP ${response.status}.`);
  }

  return data;
}

function generateCustomPortraitUrl(name, rank, gender, constellation) {
  if (rank === "Gold") {
    return "/Saga.png";
  } else if (rank === "Silver") {
    return "/Marin.png";
  } else {
    return "/Seiya.png";
  }
}

server.post('/api/generate-lore', async (req, res) => {
  const { saintName, rank, constellation, gender, isCustom } = req.body || {};

  if (!isCustom) {
    return res.status(400).json({ error: 'Official saints must use static manga lore.' });
  }

  const saintDetails = [saintName, rank, constellation];
  if (saintDetails.some((value) => typeof value !== 'string' || !value.trim() || value.length > 100)) {
    return res.status(400).json({ error: 'Saint name, rank, and constellation are required.' });
  }

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server.' });
  }

  // Determine pronoun instructions based on selected gender
  let pronounRule = "Use male pronouns (he/him/his).";
  if (gender === "Female") {
    pronounRule = "Use female pronouns (she/her/hers).";
  } else if (gender === "Other") {
    pronounRule = "Use gender-neutral pronouns (they/them/their).";
  }

  try {
    const data = await requestGroq([
      {
        role: 'user',
        content: `You are a chronicler of the Saint Seiya universe. Write a concise, 2-to-3 sentence background legend for ${saintName.trim()}, a custom ${rank.trim()} Saint of ${constellation.trim()}. 
PRONOUN RULE: ${pronounRule}
STRICT RULES:
- The character MUST serve Athena and be part of her Sanctuary army, sworn to protect Earth against rival gods like Hades or Poseidon.
- Do NOT invent non-canon magic, random kingdoms, or fantasy swords. 
- Focus strictly on their inner Cosmos, their Cloth, and their loyalty to Athena. Keep it brief and epic.`,
      },
    ]);
    const lore = data.choices?.[0]?.message?.content?.trim();

    if (!lore) {
      throw new Error('Groq returned an empty lore response.');
    }

    const customImage = generateCustomPortraitUrl(saintName, rank, gender, constellation);

    return res.json({ 
      lore,
      image: customImage
    });
  } catch (error) {
    console.error('Failed to generate saint lore:', error);
    return res.status(502).json({ error: error.message || 'Groq could not generate the lore.' });
  }
});

server.post('/api/sanctuary-alert', async (_req, res) => {
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server.' });
  }

  try {
    const data = await requestGroq(
      [
        {
          role: 'user',
          content: `You are the tactical radar for Athena's Sanctuary during a Holy War against Hades. Generate a short, intense threat alert (1-2 sentences max). Return ONLY valid JSON in this exact format: {"enemy":"Name of Specter or Threat","location":"Sanctuary Location","description":"Short threat description","requiredCosmos":100}`,
        },
      ],
      { type: 'json_object' },
    );
    const alert = JSON.parse(data.choices?.[0]?.message?.content || '');

    return res.json(alert);
  } catch (error) {
    console.error('Failed to generate sanctuary alert:', error);
    return res.status(502).json({ error: error.message || 'Groq could not generate the alert.' });
  }
});

const router = jsonServer.router('db.json');
server.use(router);

const PORT = process.env.PORT || 5005;
server.listen(PORT, () => {
  console.log(`JSON Server is running at port ${PORT}`);
  console.log(`Local Access at http://localhost:${PORT}`);
});
