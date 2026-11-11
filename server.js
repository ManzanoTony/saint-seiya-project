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
const SAINT_RECOVERY_TIME_MS = 60 * 1000;
const COSMOS_AWAKENING_CHANCE = 0.2;
const MIN_BATTLE_WIN_CHANCE = 0.1;
const MAX_BATTLE_WIN_CHANCE = 0.85;
const OFFICIAL_SAINT_IMAGES = {
  Algol: '/Algol.png',
  Misty: '/Misty.png',
};

function getThreatRange(battlesCompleted) {
  const battleNumber = Math.min(battlesCompleted + 1, 5);
  const minimum = 100 + (battleNumber - 1) * 15;
  const maximum = 180 + (battleNumber - 1) * 20;

  return { battleNumber, minimum, maximum };
}

function getBaseVictoryChance(cosmosPower, requiredCosmos) {
  const chance = 0.5 + (cosmosPower - requiredCosmos) * 0.003;
  return Math.min(MAX_BATTLE_WIN_CHANCE, Math.max(MIN_BATTLE_WIN_CHANCE, chance));
}

function getVictoryChance(cosmosPower, requiredCosmos) {
  const baseChance = getBaseVictoryChance(cosmosPower, requiredCosmos);
  if (cosmosPower >= requiredCosmos) {
    return baseChance;
  }

  return COSMOS_AWAKENING_CHANCE + (1 - COSMOS_AWAKENING_CHANCE) * baseChance;
}

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
  if (rank === "Gold" || rank.includes("Gold")) {
    return "/Saga.png";
  } else if (rank === "Silver" || rank.includes("Silver")) {
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
        content: `You are a chronicler of the Saint Seiya universe during the Hades Sanctuary Holy War arc. Write a concise, 2-to-3 sentence background legend for ${saintName.trim()}, a custom ${rank.trim()} Saint of ${constellation.trim()}. 
PRONOUN RULE: ${pronounRule}
STRICT RULES:
- The character MUST serve Athena and be part of her Sanctuary army, sworn to protect Earth against Hades and his 108 Specters.
- Do NOT invent non-canon magic, random kingdoms, or fantasy weapons. 
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

server.post('/api/sanctuary-alert', async (req, res) => {
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server.' });
  }

  const state = db.getState();
  const campaign = (state.campaigns || []).find(
    (entry) => String(entry.id) === String(req.body?.campaignId)
  );
  if (!campaign || campaign.status !== 'active') {
    return res.status(409).json({ error: 'An active campaign is required to scan for a threat.' });
  }
  const threatRange = getThreatRange(Number(campaign.battles) || 0);

  const randomSeeds = [
    "Judge of Hell Rhadamanthys leading a vanguard",
    "Fanned by Deep Niobe's Deep Black Death perfume at the Taurus Temple",
    "Cyclops Gigant leading a shock troop into the Sanctuary Colosseum",
    "Reanimated Gold Saint Saga wearing a Surplice breaching the Pope's Chamber",
    "Underworld Specter Cube of Dullahan stalking the Sanctuary Graveyard",
    "Specter Myu of Papillon spinning his fairy cocoon in the Cancer Temple",
    "Judge of Hell Minos soaring over the House of Gemini"
  ];
  const chosenSeed = randomSeeds[Math.floor(Math.random() * randomSeeds.length)];

  try {
    const data = await requestGroq(
      [
        {
          role: 'user',
          content: `You are the Sanctuary Tactical Radar during the Hades Sanctuary Holy War arc in Saint Seiya. 
Generate a COMPLETELY RANDOMized, canon-accurate tactical invasion threat. 
Inspiration seed for this alert: ${chosenSeed}.
This is battle ${threatRange.battleNumber} of the campaign. Required Cosmos MUST be between ${threatRange.minimum} and ${threatRange.maximum}. Later campaign battles must become more difficult.

STRICT CANON RULES:
- Threat location MUST take place within Sanctuary (e.g., House of Aries, House of Cancer, Sanctuary Graveyard, Colosseum, Star Hill).
- Enemies MUST vary widely (use different Underworld Specters like Rhadamanthys, Minos, Aiacos, Niobe, Gigant, Raimi, Cube, or reanimated Gold Saints in Surplices). Never repeat the exact same enemy consecutively.
- Required Cosmos must be a number between 100 and 260.

Return ONLY valid JSON in this exact format:
{
  "enemy": "Specter or Enemy Commander Name",
  "location": "Zodiac Temple or Sanctuary Location",
  "description": "Short, 1-2 sentence dramatic canon threat description.",
  "requiredCosmos": 150
}`,
        },
      ],
      { type: 'json_object' }
    );

    const alertData = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    const generatedCosmos = Number(alertData.requiredCosmos);

    if (
      typeof alertData.enemy !== 'string' ||
      !alertData.enemy.trim() ||
      typeof alertData.location !== 'string' ||
      !alertData.location.trim() ||
      typeof alertData.description !== 'string' ||
      !alertData.description.trim() ||
      !Number.isInteger(generatedCosmos) ||
      generatedCosmos < 100 ||
      generatedCosmos > 260
    ) {
      throw new Error('Groq returned an invalid Sanctuary threat.');
    }

    alertData.requiredCosmos = Math.min(
      threatRange.maximum,
      Math.max(threatRange.minimum, generatedCosmos)
    );
    alertData.battleNumber = threatRange.battleNumber;
    alertData.minimumThreatCosmos = threatRange.minimum;
    alertData.maximumThreatCosmos = threatRange.maximum;
    return res.json(alertData);
  } catch (error) {
    console.error('Failed to generate sanctuary alert:', error);
    return res.status(502).json({ error: 'Could not generate tactical alert.' });
  }
});

const router = jsonServer.router('db.json');
const db = router.db;

async function updateRecoveredSaints() {
  const state = db.getState();
  const now = Date.now();
  let stateChanged = false;
  const saints = (state.saints || []).map((saint) => {
    let updatedSaint = saint;
    const officialImage = saint.isCustom === false
      ? OFFICIAL_SAINT_IMAGES[saint.name]
      : null;

    if (officialImage && saint.image !== officialImage) {
      updatedSaint = { ...saint, image: officialImage };
      stateChanged = true;
    }

    if (saint.status !== 'Injured') {
      return updatedSaint;
    }

    const recoveryTime = Date.parse(saint.recoveryUntil);
    if (!Number.isFinite(recoveryTime)) {
      stateChanged = true;
      return {
        ...updatedSaint,
        recoveryUntil: new Date(now + SAINT_RECOVERY_TIME_MS).toISOString(),
      };
    }

    if (recoveryTime <= now) {
      stateChanged = true;
      const { recoveryUntil, ...recoveredSaint } = updatedSaint;
      return { ...recoveredSaint, status: 'Ready' };
    }

    return updatedSaint;
  });

  if (stateChanged) {
    db.setState({ ...state, saints });
    await db.write();
  }

  return saints;
}

server.get('/saints', async (_req, res) => {
  try {
    const saints = await updateRecoveredSaints();
    return res.json(saints);
  } catch (error) {
    console.error('Failed to update Saint recovery status:', error);
    return res.status(500).json({ error: 'Could not load Saints.' });
  }
});

server.patch('/saints/:id', async (req, res) => {
  try {
    await updateRecoveredSaints();
    const state = db.getState();
    const saints = state.saints || [];
    const saint = saints.find((entry) => String(entry.id) === String(req.params.id));

    if (!saint) {
      return res.status(404).json({ error: 'Saint not found.' });
    }

    if (
      saint.status === 'Injured' &&
      Object.hasOwn(req.body || {}, 'status') &&
      req.body.status !== 'Injured'
    ) {
      return res.status(409).json({
        error: 'This Saint is healing and cannot return to duty yet.',
        recoveryUntil: saint.recoveryUntil,
      });
    }

    const updatedSaint = { ...saint, ...req.body, id: saint.id };
    const updatedStatus = req.body?.status ?? saint.status;
    if (updatedStatus === 'Injured' && saint.status !== 'Injured') {
      updatedSaint.recoveryUntil = new Date(Date.now() + SAINT_RECOVERY_TIME_MS).toISOString();
    } else if (updatedStatus === 'Injured') {
      updatedSaint.recoveryUntil = saint.recoveryUntil;
    } else {
      delete updatedSaint.recoveryUntil;
    }

    db.setState({
      ...state,
      saints: saints.map((entry) =>
        String(entry.id) === String(saint.id) ? updatedSaint : entry
      ),
    });
    await db.write();
    return res.json(updatedSaint);
  } catch (error) {
    console.error('Failed to update Saint:', error);
    return res.status(500).json({ error: 'Could not update Saint.' });
  }
});

server.put('/saints/:id', async (req, res) => {
  try {
    await updateRecoveredSaints();
    const state = db.getState();
    const saints = state.saints || [];
    const saint = saints.find((entry) => String(entry.id) === String(req.params.id));

    if (!saint) {
      return res.status(404).json({ error: 'Saint not found.' });
    }

    if (saint.status === 'Injured' && req.body?.status !== 'Injured') {
      return res.status(409).json({
        error: 'This Saint is healing and cannot return to duty yet.',
        recoveryUntil: saint.recoveryUntil,
      });
    }

    const updatedSaint = { ...saint, ...req.body, id: saint.id };
    if (req.body?.status === 'Injured' && saint.status !== 'Injured') {
      updatedSaint.recoveryUntil = new Date(Date.now() + SAINT_RECOVERY_TIME_MS).toISOString();
    } else if (req.body?.status === 'Injured') {
      updatedSaint.recoveryUntil = saint.recoveryUntil;
    } else {
      delete updatedSaint.recoveryUntil;
    }

    db.setState({
      ...state,
      saints: saints.map((entry) =>
        String(entry.id) === String(saint.id) ? updatedSaint : entry
      ),
    });
    await db.write();
    return res.json(updatedSaint);
  } catch (error) {
    console.error('Failed to replace Saint:', error);
    return res.status(500).json({ error: 'Could not update Saint.' });
  }
});

server.get('/api/war/state', (_req, res) => {
  const state = db.getState();
  const campaigns = state.campaigns || [];
  const battles = (state.battles || []).sort(
    (first, second) => new Date(second.createdAt) - new Date(first.createdAt)
  );
  const campaign = campaigns.find((entry) => entry.status === 'active') || null;

  return res.json({ campaign, campaigns, battles });
});

server.post('/api/war/reset', async (_req, res) => {
  const state = db.getState();
  const saints = (state.saints || [])
    .filter((saint) => saint.isCustom !== true)
    .map((saint) => {
      const { baseCosmosPower, ...saintWithoutBasePower } = saint;

      return {
        ...saintWithoutBasePower,
        cosmosPower: baseCosmosPower ?? saint.cosmosPower,
        status: 'Ready',
        recoveryUntil: undefined,
      };
    });

  try {
    db.setState({
      ...state,
      saints,
      campaigns: [],
      battles: [],
    });
    await db.write();
    return res.json({ saints });
  } catch (error) {
    console.error('Failed to reset war campaign:', error);
    return res.status(500).json({ error: 'Could not reset the Sanctuary campaign.' });
  }
});

server.post('/api/war/campaigns', async (_req, res) => {
  try {
    await updateRecoveredSaints();
  } catch (error) {
    console.error('Failed to update Saint recovery status:', error);
    return res.status(500).json({ error: 'Could not check Saint recovery status.' });
  }

  const state = db.getState();
  state.campaigns ||= [];
  state.battles ||= [];

  const activeCampaign = state.campaigns.find((entry) => entry.status === 'active');
  if (activeCampaign) {
    return res.json(activeCampaign);
  }

  const availableSaints = (state.saints || []).filter(
    (saint) => saint.status !== 'Injured' && saint.status !== 'On Mission'
  );
  if (availableSaints.length === 0) {
    return res.status(409).json({
      error: 'No Saints are ready to defend the Sanctuary. Recover a Saint before starting a war.',
    });
  }

  const campaign = {
    id: require('node:crypto').randomUUID(),
    status: 'active',
    wins: 0,
    losses: 0,
    battles: 0,
    winTarget: 3,
    lossLimit: 3,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  state.saints = (state.saints || []).map((saint) => ({
    ...saint,
    comments: '',
  }));
  state.campaigns.push(campaign);
  try {
    db.setState(state);
    await db.write();
    return res.status(201).json(campaign);
  } catch (error) {
    console.error('Failed to create war campaign:', error);
    return res.status(500).json({ error: 'Could not save the war campaign.' });
  }
});

server.post('/api/war/campaigns/:campaignId/forfeit', async (req, res) => {
  const state = db.getState();
  const campaigns = state.campaigns || [];
  const campaign = campaigns.find(
    (entry) => String(entry.id) === String(req.params.campaignId)
  );

  if (!campaign || campaign.status !== 'active') {
    return res.status(409).json({ error: 'There is no active campaign to give up.' });
  }

  const updatedCampaign = {
    ...campaign,
    status: 'defeat',
    losses: campaign.lossLimit,
    completedAt: new Date().toISOString(),
    endedBy: 'player',
  };

  try {
    db.setState({
      ...state,
      campaigns: campaigns.map((entry) =>
        String(entry.id) === String(campaign.id) ? updatedCampaign : entry
      ),
    });
    await db.write();
    return res.json({ campaign: updatedCampaign });
  } catch (error) {
    console.error('Failed to forfeit war campaign:', error);
    return res.status(500).json({ error: 'Could not end the campaign.' });
  }
});

server.post('/api/war/campaigns/:campaignId/battles', async (req, res) => {
  const { campaignId } = req.params;
  const { saintId, threat } = req.body || {};
  const requiredCosmos = Number(threat?.requiredCosmos);

  if (
    (typeof saintId !== 'string' && typeof saintId !== 'number') ||
    !threat ||
    typeof threat.enemy !== 'string' ||
    typeof threat.location !== 'string' ||
    typeof threat.description !== 'string' ||
    !Number.isInteger(requiredCosmos) ||
    requiredCosmos < 100 ||
    requiredCosmos > 260
  ) {
    return res.status(400).json({ error: 'A valid Saint and Sanctuary threat are required.' });
  }

  try {
    await updateRecoveredSaints();
  } catch (error) {
    console.error('Failed to update Saint recovery status:', error);
    return res.status(500).json({ error: 'Could not check Saint recovery status.' });
  }

  const state = db.getState();
  const campaigns = state.campaigns || [];
  const saints = state.saints || [];
  const campaign = campaigns.find((entry) => String(entry.id) === String(campaignId));
  if (!campaign || campaign.status !== 'active') {
    return res.status(409).json({ error: 'This war campaign is no longer active.' });
  }

  const threatRange = getThreatRange(Number(campaign.battles) || 0);
  if (requiredCosmos < threatRange.minimum || requiredCosmos > threatRange.maximum) {
    return res.status(400).json({
      error: `This battle's threat must have Required Cosmos between ${threatRange.minimum} and ${threatRange.maximum}.`,
    });
  }

  const saint = saints.find((entry) => String(entry.id) === String(saintId));
  if (!saint || saint.status === 'Injured' || saint.status === 'On Mission') {
    return res.status(409).json({ error: 'This Saint is unavailable for battle.' });
  }

  const cosmosPower = Number(saint.cosmosPower) || 100;
  const victoryChance = getVictoryChance(cosmosPower, requiredCosmos);
  const cosmosAwakened = cosmosPower < requiredCosmos
    && Math.random() < COSMOS_AWAKENING_CHANCE;
  const battleCosmosPower = cosmosAwakened ? requiredCosmos : cosmosPower;
  const won = cosmosAwakened
    || Math.random() < getBaseVictoryChance(cosmosPower, requiredCosmos);
  const result = won ? 'victory' : 'defeat';
  const { recoveryUntil, ...saintReadyForUpdate } = saint;
  const updatedSaint = {
    ...saintReadyForUpdate,
    baseCosmosPower: saint.baseCosmosPower ?? cosmosPower,
    status: won ? 'Ready' : 'Injured',
    cosmosPower: won ? cosmosPower + 5 : cosmosPower,
    ...(won ? {} : {
      recoveryUntil: new Date(Date.now() + SAINT_RECOVERY_TIME_MS).toISOString(),
    }),
  };
  const updatedCampaign = {
    ...campaign,
    wins: campaign.wins + Number(won),
    losses: campaign.losses + Number(!won),
    battles: campaign.battles + 1,
  };

  if (updatedCampaign.wins >= updatedCampaign.winTarget) {
    updatedCampaign.status = 'victory';
    updatedCampaign.completedAt = new Date().toISOString();
  } else if (updatedCampaign.losses >= updatedCampaign.lossLimit) {
    updatedCampaign.status = 'defeat';
    updatedCampaign.completedAt = new Date().toISOString();
  }

  const battle = {
    id: require('node:crypto').randomUUID(),
    campaignId: campaign.id,
    saintId: saint.id,
    saintName: saint.name,
    enemy: threat.enemy.trim().slice(0, 120),
    location: threat.location.trim().slice(0, 120),
    description: threat.description.trim().slice(0, 500),
    battleNumber: threatRange.battleNumber,
    requiredCosmos,
    cosmosPower,
    battleCosmosPower,
    cosmosAwakened,
    victoryChance: Math.round(victoryChance * 100),
    result,
    explanation: won
      ? cosmosAwakened
        ? `${saint.name}'s Cosmos awakened against the odds, reaching ${battleCosmosPower} and defeating the threat. The Saint gained 5 Cosmos.`
        : cosmosPower < requiredCosmos
          ? `${saint.name} defeated the stronger threat through determination and skill, despite having only ${cosmosPower} Cosmos.`
        : `${saint.name}'s Cosmos overcame the threat. The Saint gained 5 Cosmos.`
      : `${saint.name}'s Cosmos could not overcome the threat and the Saint was injured.`,
    createdAt: new Date().toISOString(),
  };

  const updatedState = {
    ...state,
    campaigns: campaigns.map((entry) =>
      String(entry.id) === String(campaignId) ? updatedCampaign : entry
    ),
    saints: saints.map((entry) =>
      String(entry.id) === String(saint.id) ? updatedSaint : entry
    ),
    battles: [...(state.battles || []), battle],
  };

  try {
    db.setState(updatedState);
    await db.write();
    return res.json({ campaign: updatedCampaign, battle, saint: updatedSaint });
  } catch (error) {
    console.error('Failed to record war battle:', error);
    return res.status(500).json({ error: 'Could not save the battle result.' });
  }
});

server.use(router);

const PORT = process.env.PORT || 5005;
server.listen(PORT, () => {
  console.log(`JSON Server is running at port ${PORT}`);
  console.log(`Local Access at http://localhost:${PORT}`);
});
