"use strict";

const axios = require("axios");
const {
  gmd,
  commands,
  monospace,
} = require("../black_hat");

const { sendButtons } = require("gifted-btns");

/* ============================================================
 * 🖥️ BLACK HAT — PTERODACTYL CPANEL SYSTEM
 * ============================================================
 *
 * ENV:
 *
 * PTERODACTYL_URL=https://panel.example.com
 * PTERODACTYL_API_KEY=ptla_xxxxxxxxx
 *
 * PAYSTACK_SECRET_KEY=sk_live_xxxxxxxxx
 *
 * CPANEL_CURRENCY=KES
 * CPANEL_UNLIMITED_PRICE=500
 * CPANEL_LIMITED_PRICE=200
 * CPANEL_ADMIN_PRICE=1000
 *
 * ============================================================
 */


/* ============================================================
 * ENVIRONMENT
 * ============================================================
 */

const PANEL_URL = String(
  process.env.PTERODACTYL_URL || ""
).replace(/\/+$/, "");

const PANEL_API_KEY =
  process.env.PTERODACTYL_API_KEY || "";

const PAYSTACK_SECRET_KEY =
  process.env.PAYSTACK_SECRET_KEY || "";

const CURRENCY =
  process.env.CPANEL_CURRENCY || "KES";

const DEFAULT_UNLIMITED_PRICE = Number(
  process.env.CPANEL_UNLIMITED_PRICE || 500
);

const DEFAULT_LIMITED_PRICE = Number(
  process.env.CPANEL_LIMITED_PRICE || 200
);

const DEFAULT_ADMIN_PRICE = Number(
  process.env.CPANEL_ADMIN_PRICE || 1000
);

const DEFAULT_CPU = Number(
  process.env.CPANEL_DEFAULT_CPU || 100
);

const DEFAULT_RAM = Number(
  process.env.CPANEL_DEFAULT_RAM || 1024
);

const DEFAULT_DISK = Number(
  process.env.CPANEL_DEFAULT_DISK || 5000
);


/* ============================================================
 * MEMORY SETTINGS
 *
 * Kama project yako ina database/settings system,
 * unaweza baadaye kuhamishia hizi settings PostgreSQL.
 * ============================================================
 */

const cpanelSettings = {
  nest: null,
  egg: null,
  node: null,
  location: null,

  cpu: DEFAULT_CPU,
  ram: DEFAULT_RAM,
  disk: DEFAULT_DISK,

  unlimitedPrice: DEFAULT_UNLIMITED_PRICE,
  limitedPrice: DEFAULT_LIMITED_PRICE,
  adminPrice: DEFAULT_ADMIN_PRICE,
};


/* ============================================================
 * BASIC HELPERS
 * ============================================================
 */

function panelConfigured() {
  return Boolean(PANEL_URL && PANEL_API_KEY);
}


function paystackConfigured() {
  return Boolean(PAYSTACK_SECRET_KEY);
}


function panelHeaders() {
  return {
    Authorization: `Bearer ${PANEL_API_KEY}`,
    Accept: "Application/vnd.pterodactyl.v1+json",
    "Content-Type": "application/json",
  };
}


function cleanEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}


function randomPassword(length = 14) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

  let password = "";

  for (let i = 0; i < length; i++) {
    password += chars.charAt(
      Math.floor(Math.random() * chars.length)
    );
  }

  return password;
}


function randomUsername(email) {
  const name = String(email)
    .split("@")[0]
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 18);

  return (
    (name || "user") +
    Math.floor(Math.random() * 9999)
  ).toLowerCase();
}


function formatMB(value) {
  if (!value) return "0 MB";

  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} GB`;
  }

  return `${value} MB`;
}


function panelError(error) {
  if (error?.response?.data?.errors) {
    return error.response.data.errors
      .map((e) => {
        return (
          e.detail ||
          e.code ||
          "Unknown Pterodactyl error"
        );
      })
      .join("\n");
  }

  return (
    error?.response?.data?.message ||
    error?.message ||
    String(error)
  );
}


/* ============================================================
 * PTERODACTYL API
 * ============================================================
 */

async function panelRequest(
  method,
  endpoint,
  data = undefined,
  params = undefined
) {
  if (!panelConfigured()) {
    throw new Error(
      "Pterodactyl Not properly installed in env .env\n\n" +
      "Weka:\n" +
      "PTERODACTYL_URL=https://panel.example.com\n" +
      "PTERODACTYL_API_KEY=ptla_xxxxx"
    );
  }

  const response = await axios({
    method,
    url: `${PANEL_URL}/api/application${endpoint}`,
    headers: panelHeaders(),
    data,
    params,
    timeout: 30000,
  });

  return response.data;
}


/* ============================================================
 * GET USERS
 * ============================================================
 */

async function findUserByEmail(email) {
  const result = await panelRequest(
    "GET",
    "/users",
    undefined,
    {
      filter: `email:${email}`,
      per_page: 100,
    }
  );

  return (
    result?.data?.find(
      (item) =>
        cleanEmail(item.attributes?.email) ===
        cleanEmail(email)
    ) || null
  );
}


async function findUser(email) {
  return findUserByEmail(email);
}


/* ============================================================
 * CREATE USER
 * ============================================================
 */

async function createPanelUser(email) {
  const existing = await findUser(email);

  if (existing) {
    return {
      created: false,
      user: existing.attributes,
    };
  }

  const username = randomUsername(email);
  const password = randomPassword();

  const result = await panelRequest(
    "POST",
    "/users",
    {
      email,
      username,
      first_name: username,
      last_name: "User",
      password,
      root_admin: false,
      language: "en",
    }
  );

  return {
    created: true,
    user: result.attributes,
    password,
  };
}


/* ============================================================
 * DELETE USER
 * ============================================================
 */

async function deletePanelUser(email) {
  const user = await findUser(email);

  if (!user) {
    throw new Error(
      `User not found: ${email}`
    );
  }

  await panelRequest(
    "DELETE",
    `/users/${user.attributes.id}`
  );

  return user.attributes;
}


/* ============================================================
 * ADMIN
 * ============================================================
 */

async function makeAdmin(email) {
  const user = await findUser(email);

  if (!user) {
    throw new Error(
      `User not found: ${email}`
    );
  }

  if (user.attributes.root_admin) {
    return {
      alreadyAdmin: true,
      user: user.attributes,
    };
  }

  const result = await panelRequest(
    "PATCH",
    `/users/${user.attributes.id}`,
    {
      root_admin: true,
    }
  );

  return {
    alreadyAdmin: false,
    user: result.attributes,
  };
}


/* ============================================================
 * NESTS
 * ============================================================
 */

async function getNests() {
  const result = await panelRequest(
    "GET",
    "/nests",
    undefined,
    {
      per_page: 100,
    }
  );

  return result.data || [];
}


async function getNest(id) {
  return await panelRequest(
    "GET",
    `/nests/${id}`
  );
}


/* ============================================================
 * EGGS
 * ============================================================
 */

async function getEggs(nestId) {
  const result = await panelRequest(
    "GET",
    `/nests/${nestId}/eggs`,
    undefined,
    {
      per_page: 100,
    }
  );

  return result.data || [];
}


/* ============================================================
 * NODES
 * ============================================================
 */

async function getNodes() {
  const result = await panelRequest(
    "GET",
    "/nodes",
    undefined,
    {
      per_page: 100,
    }
  );

  return result.data || [];
}


/* ============================================================
 * LOCATIONS
 * ============================================================
 */

async function getLocations() {
  const result = await panelRequest(
    "GET",
    "/locations",
    undefined,
    {
      per_page: 100,
    }
  );

  return result.data || [];
}


/* ============================================================
 * ALLOCATIONS
 * ============================================================
 */

async function getAllocations(nodeId) {
  const result = await panelRequest(
    "GET",
    `/nodes/${nodeId}/allocations`,
    undefined,
    {
      per_page: 100,
    }
  );

  return result.data || [];
}


async function getFreeAllocation(nodeId) {
  const allocations = await getAllocations(nodeId);

  return allocations.find(
    (allocation) =>
      allocation.attributes &&
      !allocation.attributes.assigned
  );
}


/* ============================================================
 * CREATE SERVER
 * ============================================================
 */

async function getEgg(eggId, nestId) {
  const result = await panelRequest(
    "GET",
    `/nests/${Number(nestId)}/eggs/${Number(eggId)}`,
    undefined,
    {
      include: "variables",
    }
  );

  return result;
}


/* ============================================================
 * BUILD EGG ENVIRONMENT
 * ============================================================
 */

function buildEggEnvironment(egg) {
  const variables =
    egg?.attributes?.relationships?.variables?.data ||
    egg?.relationships?.variables?.data ||
    [];

  const environment = {};
  const missing = [];

  for (const item of variables) {
    const variable = item?.attributes || item;

    const key = String(
      variable?.env_variable || ""
    ).trim();

    if (!key) continue;

    let value = variable?.default_value;

    const upperKey = key.toUpperCase();

    /*
     * Common Pterodactyl NodeJS variables
     */

    if (
      value === undefined ||
      value === null ||
      String(value).trim() === ""
    ) {
      if (
        upperKey === "MAIN_FILE" ||
        upperKey.includes("MAIN_FILE")
      ) {
        value = "index.js";
      }

      else if (
        upperKey === "AUTO_UPDATE" ||
        upperKey.includes("AUTO_UPDATE")
      ) {
        value = "0";
      }

      else if (
        upperKey === "USER_UPLOAD" ||
        upperKey.includes("USER_UPLOAD")
      ) {
        value = "0";
      }
    }

    /*
     * Required variable without value
     */

    if (
      value === undefined ||
      value === null ||
      String(value).trim() === ""
    ) {
      if (variable?.required) {
        missing.push(
          variable?.name ||
          variable?.env_variable ||
          key
        );
      }

      continue;
    }

    environment[key] = String(value);
  }

  if (missing.length) {
    throw new Error(
      "Pterodactyl Egg has required variables without values:\n\n" +
      missing
        .map((x) => `• ${x}`)
        .join("\n") +
      "\n\n" +
      "Weka default value kwenye Egg Variables au tumia Egg nyingine."
    );
  }

  return environment;
}


/* ============================================================
 * CREATE SERVER
 * ============================================================
 */

async function createPanelServer({
  email,
  unlimited = false,
}) {
  /*
   * FIND USER
   */

  const user = await findUser(email);

  if (!user) {
    throw new Error(
      `User not found: ${email}`
    );
  }


  /*
   * CHECK CONFIG
   */

  if (!cpanelSettings.nest) {
    throw new Error(
      "Nest not installed.\n\n" +
      "Use:\n" +
      ".nestconfig nests\n" +
      ".nestconfig nest <id>"
    );
  }


  if (!cpanelSettings.egg) {
    throw new Error(
      "Egg not set.\n\n" +
      "Tumia:\n" +
      `.nestconfig eggs ${cpanelSettings.nest}\n` +
      ".nestconfig egg <id>"
    );
  }


  if (!cpanelSettings.node) {
    throw new Error(
      "Node not set.\n\n" +
      ".nestconfig nodes\n" +
      ".nestconfig node <id>"
    );
  }


  if (!cpanelSettings.location) {
    throw new Error(
      "Location not set.\n\n" +
      ".nestconfig locations\n" +
      ".nestconfig location <id>"
    );
  }


  const nestId =
    Number(cpanelSettings.nest);

  const eggId =
    Number(cpanelSettings.egg);

  const nodeId =
    Number(cpanelSettings.node);

  const locationId =
    Number(cpanelSettings.location);


  /*
   * VALIDATE IDS
   */

  if (
    !Number.isInteger(nestId) ||
    nestId <= 0
  ) {
    throw new Error(
      `Invalid Nest ID: ${cpanelSettings.nest}`
    );
  }


  if (
    !Number.isInteger(eggId) ||
    eggId <= 0
  ) {
    throw new Error(
      `Invalid Egg ID: ${cpanelSettings.egg}`
    );
  }


  if (
    !Number.isInteger(nodeId) ||
    nodeId <= 0
  ) {
    throw new Error(
      `Invalid Node ID: ${cpanelSettings.node}`
    );
  }


  if (
    !Number.isInteger(locationId) ||
    locationId <= 0
  ) {
    throw new Error(
      `Invalid Location ID: ${cpanelSettings.location}`
    );
  }


  /*
   * GET FREE PORT
   */

  const allocation =
    await getFreeAllocation(nodeId);

  if (
    !allocation ||
    !allocation.attributes ||
    !allocation.attributes.id
  ) {
    throw new Error(
      "❌ There is no free allocation/port on this Node."
    );
  }


  /*
   * GET REAL EGG
   *
   * Hatutumii Docker image/startup ya
   * hard-code.
   */

  const egg =
    await getEgg(
      eggId,
      nestId
    );

  const eggAttributes =
    egg?.attributes;

  if (!eggAttributes) {
    throw new Error(
      `Egg ${eggId} not found in Pterodactyl.`
    );
  }


  /*
   * BUILD ENVIRONMENT
   *
   * Hapa ndipo tunarekebisha error kama:
   *
   * User Uploaded Files variable field is required
   * Auto Update variable field is required
   * Main file variable field is required
   */

  const environment =
    buildEggEnvironment(egg);


  /*
   * SERVER RESOURCES
   */

  const resources =
    unlimited
      ? {
          memory: 0,
          swap: 0,
          disk: 0,
          io: 500,
          cpu: 0,
        }
      : {
          memory:
            Number(cpanelSettings.ram),

          swap: 0,

          disk:
            Number(cpanelSettings.disk),

          io: 500,

          cpu:
            Number(cpanelSettings.cpu),
        };


  /*
   * SERVER PAYLOAD
   */

  const payload = {
    name:
      `${unlimited ? "Unlimited" : "Server"}-${user.attributes.username}`,

    user:
      Number(user.attributes.id),

    egg:
      eggId,

    docker_image:
      eggAttributes.docker_image ||
      "ghcr.io/parkervcp/yolks:nodejs_25",

    startup:
      eggAttributes.startup ||
      "npm start",

    environment,

    limits:
      resources,

    feature_limits: {
      databases: 0,
      allocations: 1,
      backups: 0,
    },


    /*
     * MUHIMU:
     *
     * Pterodactyl Application API
     * inatumia "deploy"
     * sio "deployment"
     */

    deploy: {
      locations: [
        locationId,
      ],

      dedicated_ip:
        false,

      port_range: [],
    },


    /*
     * START SERVER
     */

    start_on_completion:
      true,


    /*
     * ALLOCATION
     */

    allocation: {
      default:
        Number(
          allocation.attributes.id
        ),
    },
  };


  /*
   * CREATE SERVER
   */

  try {
    const result =
      await panelRequest(
        "POST",
        "/servers",
        payload
      );

    return {
      server:
        result.attributes,

      allocation:
        allocation.attributes,

      user:
        user.attributes,

      environment,

      egg:
        eggAttributes,
    };

  } catch (error) {

    const message =
      panelError(error);


    /*
     * BETTER VARIABLE ERROR
     */

    if (
      /variable.*required|required.*variable/i
        .test(message)
    ) {
      throw new Error(
        `${message}\n\n` +
        "Deployed variables:\n" +
        (
          Object.keys(environment).length
            ? Object.entries(environment)
                .map(
                  ([key, value]) =>
                    `• ${key} = ${value}`
                )
                .join("\n")
            : "• No variables found"
        )
      );
    }


    throw new Error(message);
  }
}


/* ============================================================
 * SERVER LIST
 * ============================================================
 */

async function getServers() {
  const result = await panelRequest(
    "GET",
    "/servers",
    undefined,
    {
      per_page: 100,
    }
  );

  return result.data || [];
}


/* ============================================================
 * DELETE SERVER
 * ============================================================
 */

async function deleteServer(serverId) {
  await panelRequest(
    "DELETE",
    `/servers/${serverId}`,
  );

  return true;
}


/* ============================================================
 * 💳 PAYSTACK
 * ============================================================
 */

async function paystackRequest(
  method,
  endpoint,
  data
) {
  if (!paystackConfigured()) {
    throw new Error(
      "PAYSTACK_SECRET_KEY not installed on .env"
    );
  }

  const response = await axios({
    method,
    url: `https://api.paystack.co${endpoint}`,
    headers: {
      Authorization:
        `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    data,
    timeout: 30000,
  });

  return response.data;
}


/* ============================================================
 * PAYSTACK INITIALIZE
 * ============================================================
 */

async function initializePayment({
  email,
  amount,
  metadata = {},
}) {
  const result =
    await paystackRequest(
      "POST",
      "/transaction/initialize",
      {
        email,
        amount: Math.round(amount * 100),
        currency: CURRENCY,
        metadata,
      }
    );

  if (!result.status) {
    throw new Error(
      result.message ||
        "Paystack payment initialization failed"
    );
  }

  return result.data;
}


/* ============================================================
 * 💳 PAYMENT SETTINGS
 * ============================================================
 */

gmd(
  {
    pattern: "setpayment",
    aliases: ["paymentprice", "prices"],
    react: "💳",
    category: "cpanel",
    description:
      "Set or view CPanel payment prices.",
  },

  async (from, Gifted, conText) => {
    const {
      q,
      reply,
      react,
      botPrefix,
      isSuperUser,
    } = conText;

    if (!isSuperUser) {
      return reply(
        "❌ *Owner Only Command!*"
      );
    }

    const args = String(q || "")
      .trim()
      .split(/\s+/);

    if (!q) {
      return reply(`
╭─⊷ *💳 CPANEL PRICES*
│
│ Currency: ${CURRENCY}
│
│ 🟢 Unlimited: ${cpanelSettings.unlimitedPrice} ${CURRENCY}
│ 🟡 Limited:   ${cpanelSettings.limitedPrice} ${CURRENCY}
│ 🔴 Admin:     ${cpanelSettings.adminPrice} ${CURRENCY}
│
├─⊷ Examples:
│ ${botPrefix}setpayment unli 500
│ ${botPrefix}setpayment lim 200
│ ${botPrefix}setpayment admin 1000
│
╰─⧭⊷
`.trim());
    }

    const type = args[0]?.toLowerCase();
    const amount = Number(args[1]);

    if (
      !["unli", "lim", "admin"].includes(type)
    ) {
      return reply(
        `❌ Invalid type.\n\nUse:\n${botPrefix}setpayment unli 500\n${botPrefix}setpayment lim 200\n${botPrefix}setpayment admin 1000`
      );
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return reply(
        "❌ Set the right amount."
      );
    }

    if (type === "unli") {
      cpanelSettings.unlimitedPrice =
        amount;
    }

    if (type === "lim") {
      cpanelSettings.limitedPrice =
        amount;
    }

    if (type === "admin") {
      cpanelSettings.adminPrice =
        amount;
    }

    await react("✅");

    return reply(
      `✅ *Payment Updated*\n\n` +
      `Plan: ${type}\n` +
      `Price: ${amount} ${CURRENCY}`
    );
  }
);


/* ============================================================
 * 🖥️ CPANEL MENU
 * ============================================================
 */

gmd(
  {
    pattern: "cpanelmenu",
    aliases: ["cpanel"],
    react: "🖥️",
    category: "cpanel",
    description:
      "Display complete CPanel management menu.",
  },

  async (from, Gifted, conText) => {
    const {
      mek,
      react,
      reply,
      botName,
      botFooter,
      botPic,
      botPrefix,
      newsletterUrl,
      isSuperUser,
    } = conText;

    if (!isSuperUser) {
      return reply(
        "❌ *Owner Only Command!*"
      );
    }

    const menu = `
╭─⌈ \`BLACK HAT\` ⌋
┃ Menu: *🖥️ CPANEL MENU*
└─⧭⊷

┌─⧭⊷ *⚙️ SETUP*
│  • ${botPrefix}setlink
│  • ${botPrefix}setkey
│  • ${botPrefix}mysetkey
└─⧭⊷

┌─⧭⊷ *🏗️ NEST CONFIG*
│  • ${botPrefix}nestconfig
└─⧭⊷

┌─⧭⊷ *👤 USERS*
│  • ${botPrefix}createuser
│  • ${botPrefix}deleteuser
│  • ${botPrefix}makeadmin
│  • ${botPrefix}listusers
│  • ${botPrefix}totalusers
│  • ${botPrefix}listadminusers
│  • ${botPrefix}demoteadminusers
│  • ${botPrefix}deleteallusers
└─⧭⊷

┌─⧭⊷ *🖥️ SERVERS*
│  • ${botPrefix}createpanel
│  • ${botPrefix}createunlimited
│  • ${botPrefix}deletepanel
│  • ${botPrefix}listpanels
│  • ${botPrefix}totalpanels
│  • ${botPrefix}deleteall
└─⧭⊷

┌─⧭⊷ *💳 PAYSTACK*
│  • ${botPrefix}setpaystackkey
│  • ${botPrefix}setpayment
│  • ${botPrefix}prompt
└─⧭⊷
`.trim();

    const guideId =
      `cpanel_guide_${Date.now()}`;

    const mainId =
      `cpanel_main_${Date.now()}`;

    await sendButtons(Gifted, from, {
      title:
        `🖥️ ${botName || "BLACK HAT"} CPanel`,

      text: menu,

      footer:
        `> *${botFooter || "BLACK HAT"}*`,

      image: botPic
        ? { url: botPic }
        : undefined,

      buttons: [
        {
          id: guideId,
          text: "📘 Cpanel Guide",
        },

        {
          id: mainId,
          text: "🏠 Main Menu",
        },

        {
          name: "cta_url",

          buttonParamsJson:
            JSON.stringify({
              display_text:
                "📢 WaChannel",

              url:
                newsletterUrl ||
                "https://whatsapp.com/channel/0029Vb73SRl1CYoLWtyr4u1X",
            }),
        },
      ],
    });

    const handler =
      async (event) => {
        try {
          const message =
            event?.messages?.[0];

          if (!message?.message)
            return;

          if (
            message.key?.remoteJid !==
            from
          ) {
            return;
          }

          const button =
            message.message
              ?.templateButtonReplyMessage;

          if (!button)
            return;

          const id =
            button.selectedId;

          if (!id)
            return;


          /* ======================================
           * 📘 GUIDE
           * ======================================
           */

          if (id === guideId) {
            const guide = `
╭─⌈ \`BLACK HAT\` ⌋
┃ Menu: *📘 CPanel Guide*
╰─⧭⊷

╭─⊷ *⚙️ STEP 1 — SETUP*
│
├◆ *${botPrefix}setlink <url>*
│  └⊷ Set Pterodactyl panel URL
│
├◆ *${botPrefix}setkey <api-key>*
│  └⊷ Set Application API key
│
├◆ *${botPrefix}mysetkey*
│  └⊷ Show saved API key
│
╰─⧭⊷

╭─⊷ *🏗️ STEP 2 — NEST CONFIG*
│
├◆ *${botPrefix}nestconfig*
│  └⊷ View current configuration
│
├◆ *${botPrefix}nestconfig nests*
│  └⊷ List all nests
│
├◆ *${botPrefix}nestconfig eggs <nestId>*
│  └⊷ List eggs
│
├◆ *${botPrefix}nestconfig nodes*
│  └⊷ List nodes
│
├◆ *${botPrefix}nestconfig locations*
│  └⊷ List locations
│
├◆ *${botPrefix}nestconfig nest <id>*
│  └⊷ Set Nest
│
├◆ *${botPrefix}nestconfig egg <id>*
│  └⊷ Set Egg
│
├◆ *${botPrefix}nestconfig node <id>*
│  └⊷ Set Node
│
├◆ *${botPrefix}nestconfig location <id>*
│  └⊷ Set Location
│
├◆ *${botPrefix}nestconfig cpu <value>*
│  └⊷ Set CPU
│
├◆ *${botPrefix}nestconfig ram <value>*
│  └⊷ Set RAM
│
├◆ *${botPrefix}nestconfig disk <value>*
│  └⊷ Set Disk
│
╰─⧭⊷

╭─⊷ *👤 STEP 3 — USERS*
│
├◆ *${botPrefix}createuser <email>*
├◆ *${botPrefix}deleteuser <email>*
├◆ *${botPrefix}makeadmin <email>*
├◆ *${botPrefix}listusers*
├◆ *${botPrefix}totalusers*
├◆ *${botPrefix}listadminusers*
├◆ *${botPrefix}demoteadminusers*
└◆ *${botPrefix}deleteallusers*

╭─⊷ *🖥️ STEP 4 — SERVERS*
│
├◆ *${botPrefix}createpanel <email>*
│  └⊷ Create limited server
│
├◆ *${botPrefix}createunlimited <email>*
│  └⊷ Create unlimited server
│
├◆ *${botPrefix}deletepanel <server-id>*
├◆ *${botPrefix}listpanels*
├◆ *${botPrefix}totalpanels*
└◆ *${botPrefix}deleteall*

╭─⊷ *💳 STEP 5 — PAYMENTS*
│
├◆ *${botPrefix}setpaystackkey <key>*
├◆ *${botPrefix}setpayment unli <amount>*
├◆ *${botPrefix}setpayment lim <amount>*
├◆ *${botPrefix}setpayment admin <amount>*
├◆ *${botPrefix}setpayment*
│
└◆ *${botPrefix}prompt <phone> <email> <plan>*
`.trim();

            await sendButtons(
              Gifted,
              from,
              {
                title:
                  "📘 CPanel Guide",

                text: guide,

                footer:
                  `> *${botFooter || "BLACK HAT"}*`,

                buttons: [
                  {
                    id:
                      `${botPrefix}cpanelmenu`,
                    text:
                      "↩️ CPanel Menu",
                  },

                  {
                    id:
                      `${botPrefix}menu`,
                    text:
                      "🏠 Main Menu",
                  },
                ],
              }
            );

            await react("📘");
          }



          /* ======================================
           * 🏠 MAIN MENU
           * ======================================
           */

          if (id === mainId) {
            await Gifted.sendMessage(
              from,
              {
                text:
                  `${botPrefix}menu`,
              },
              {
                quoted:
                  message,
              }
            );

            await react("🏠");
          }

        } catch (error) {
          console.error(
            "CPanel Button Error:",
            error
          );
        }
      };


    Gifted.ev.on(
      "messages.upsert",
      handler
    );


    setTimeout(() => {
      Gifted.ev.off(
        "messages.upsert",
        handler
      );
    }, 120000);


    await react("🖥️");
  }
);


/* ============================================================
 * 👤 CREATE USER
 * ============================================================
 */

gmd(
  {
    pattern: "createuser",
    aliases: ["adduser", "cruser"],
    react: "👤",
    category: "cpanel",
    description:
      "Create Pterodactyl user account.",
  },

  async (from, Gifted, conText) => {
    const {
      q,
      reply,
      react,
      botFooter,
      botPrefix,
    } = conText;

    const email =
      cleanEmail(q);

    if (!email) {
      return reply(
        `❌ Usage:\n${botPrefix}createuser user@example.com`
      );
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        email
      )
    ) {
      return reply(
        "❌ Invalid email address."
      );
    }

    try {
      const result =
        await createPanelUser(email);

      const user =
        result.user;

      const text = `
╭─⌈ *👤 USER CREATED* ⌋
┃
┃ 📧 Email: ${user.email}
┃ 👤 Username: ${user.username}
┃ 🆔 ID: ${user.id}
┃ 🔐 Password: ${result.password || "Existing account"}
┃ 👑 Admin: ${user.root_admin ? "YES" : "NO"}
┃
╰─⧭⊷
`.trim();

      const buttons = [];

      if (result.password) {
        buttons.push({
          name: "cta_copy",
          buttonParamsJson:
            JSON.stringify({
              display_text:
                "📋 Copy Password",
              copy_code:
                result.password,
            }),
        });
      }

      buttons.push({
        name: "cta_copy",
        buttonParamsJson:
          JSON.stringify({
            display_text:
              "📋 Copy Username",
            copy_code:
              user.username,
          }),
      });

      await sendButtons(
        Gifted,
        from,
        {
          title:
            "👤 Pterodactyl User",

          text,

          footer:
            `> *${botFooter || "BLACK HAT"}*`,

          buttons,
        }
      );

      await react("✅");

    } catch (error) {
      console.error(error);

      return reply(
        `❌ Create User Failed:\n${panelError(error)}`
      );
    }
  }
);


/* ============================================================
 * 👑 LIST ADMIN USERS
 * ============================================================
 */

gmd(
  {
    pattern: "listadminusers",
    aliases: ["admins", "superusers"],
    react: "👑",
    category: "cpanel",
    description: "List admin Pterodactyl users.",
  },

  async (from, Gifted, conText) => {
    const {
      reply,
      react,
      botPrefix,
    } = conText;

    try {
      const result =
        await panelRequest(
          "GET",
          "/users",
          undefined,
          {
            per_page: 100,
          }
        );

      const allUsers =
        result.data || [];

      const adminUsers =
        allUsers.filter(
          (item) =>
            item.attributes?.root_admin === true
        );

      if (!adminUsers.length) {
        return reply(
          "🚫 No admin users found."
        );
      }

      let text =
        `╭─ ─ ─ ─ ─ ─ [*👑 ADMINS*] ─ ─ ─ ─ ─ 📜\n`;

      adminUsers.forEach(
        (item, index) => {
          const u =
            item.attributes;

          text +=
            `│ ${index + 1}. ${u.username}\n` +
            `│    📧 ${u.email}\n` +
            `│    🆔 ${u.id}\n`;
        }
      );

      text +=
        `╰─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ 💠\n\n` +
        `Total: ${adminUsers.length}`;

      await reply(text);

      await react("👑");

    } catch (error) {
      return reply(
        `❌ Error:\n${panelError(error)}`
      );
    }
  }
);


/* ============================================================
 * 👥 LIST USERS
 * ============================================================
 */

gmd(
  {
    pattern: "listusers",
    aliases: ["users", "ptusers"],
    react: "👥",
    category: "cpanel",
    description:
      "List Pterodactyl users.",
  },

  async (from, Gifted, conText) => {
    const {
      reply,
      react,
      botPrefix,
    } = conText;

    try {
      const result =
        await panelRequest(
          "GET",
          "/users",
          undefined,
          {
            per_page: 100,
          }
        );

      const users =
        result.data || [];

      if (!users.length) {
        return reply(
          "📭 No users found."
        );
      }

      let text =
        `╭─⌈ *👥 USERS* ⌋\n`;

      users.forEach(
        (item, index) => {
          const u =
            item.attributes;

          text +=
            `┃ ${index + 1}. ${u.username}\n` +
            `┃    📧 ${u.email}\n` +
            `┃    🆔 ${u.id}\n` +
            `┃    👑 ${u.root_admin ? "Admin" : "User"}\n`;
        }
      );

      text +=
        `╰─⧭⊷\n\n` +
        `Total: ${users.length}`;

      await reply(text);

      await react("✅");

    } catch (error) {
      return reply(
        `❌ Error:\n${panelError(error)}`
      );
    }
  }
);


/* ============================================================
 * 🔢 TOTAL USERS
 * ============================================================
 */

gmd(
  {
    pattern: "totalusers",
    react: "🔢",
    category: "cpanel",
    description:
      "Show total Pterodactyl users.",
  },

  async (from, Gifted, conText) => {
    const {
      reply,
      react,
    } = conText;

    try {
      const result =
        await panelRequest(
          "GET",
          "/users",
          undefined,
          {
            per_page: 1,
          }
        );

      const total =
        result.meta?.pagination?.total ||
        result.data?.length ||
        0;

      await reply(
        `👥 *Total Users:* ${total}`
      );

      await react("✅");

    } catch (error) {
      return reply(
        `❌ Error:\n${panelError(error)}`
      );
    }
  }
);


/* ============================================================
 * 👑 MAKE ADMIN
 * ============================================================
 */
 
gmd(
  {
    pattern: "makeadmin",
    aliases: ["promoteadmin", "makepro"],
    react: "👑",
    category: "cpanel",
    description:
      "Make Pterodactyl user administrator.",
  },

  async (from, Gifted, conText) => {
    const {
      q,
      reply,
      react,
      botPrefix,
    } = conText;

    const email =
      cleanEmail(q);

    if (!email) {
      return reply(
        `❌ Usage:\n${botPrefix}makeadmin user@example.com`
      );
    }

    try {
      const result =
        await makeAdmin(email);

      if (result.alreadyAdmin) {
        return reply(
          `ℹ️ ${email} is already an admin.`
        );
      }

      await reply(
        `✅ *Admin Granted*\n\n📧 ${email}\n👑 Root Admin: YES`
      );

      await react("👑");

    } catch (error) {
      return reply(
        `❌ Error:\n${panelError(error)}`
      );
    }
  }
);


/* ============================================================

/* ============================================================
 * ⬇️ DEMOTE ADMIN
 * ============================================================
 */

async function demoteAdmin(email) {
  const user = await findUser(email);

  if (!user) {
    throw new Error(
      `User not found: ${email}`
    );
  }

  if (!user.attributes.root_admin) {
    return {
      alreadyNonAdmin: true,
      user: user.attributes,
    };
  }

  const result = await panelRequest(
    "PATCH",
    `/users/${user.attributes.id}`,
    {
      root_admin: false,
    }
  );

  return {
    alreadyNonAdmin: false,
    user: result.attributes,
  };
}


gmd(
  {
    pattern: "demoteadminusers",
    aliases: ["demoteadmin", "removeadmin"],
    react: "⬇️",
    category: "cpanel",
    description:
      "Remove admin privileges from user.",
  },

  async (from, Gifted, conText) => {
    const {
      q,
      reply,
      react,
      botPrefix,
    } = conText;

    const email =
      cleanEmail(q);

    if (!email) {
      return reply(
        `❌ Usage:\n${botPrefix}demoteadmin user@example.com`
      );
    }

    try {
      const result = await demoteAdmin(email);

      if (result.alreadyNonAdmin) {
        return reply(
          `ℹ️ ${email} is not an admin.`
        );
      }

      await reply(
        `✅ *Admin Privileges Removed*\n\n📧 ${email}\n👑 Root Admin: NO`
      );

      await react("⬇️");

    } catch (error) {
      return reply(
        `❌ Error:\n${panelError(error)}`
      );
    }
  }
);


/* ============================================================
 * 🗑️ DELETE ALL USERS
 * ============================================================
 */

gmd(
  {
    pattern: "deleteallusers",
    aliases: ["purgeallusers", "clearusers"],
    react: "🗑️",
    category: "cpanel",
    description:
      "Delete all Pterodactyl users.",
  },

  async (from, Gifted, conText) => {
    const {
      reply,
      react,
      isSuperUser,
    } = conText;

    if (!isSuperUser) {
      return reply(
        "❌ *Owner Only Command!*"
      );
    }

    try {
      const result = await panelRequest(
        "GET",
        "/users",
        undefined,
        {
          per_page: 100,
        }
      );

      const users = result.data || [];

      if (!users.length) {
        return reply(
          "✅ No users to delete."
        );
      }

      for (const user of users) {
        await panelRequest(
          "DELETE",
          `/users/${user.attributes.id}`
        );
      }

      await reply(
        `✅ *All Users Deleted*\n\nTotal: ${users.length} users`
      );

      await react("🗑️");

    } catch (error) {
      return reply(
        `❌ Error:\n${panelError(error)}`
      );
    }
  }
);


/* ============================================================
 * 🗑️ DELETE ALL SERVERS
 * ============================================================
 */

gmd(
  {
    pattern: "deleteall",
    aliases: ["deleteallservers", "purgeallservers"],
    react: "🗑️",
    category: "cpanel",
    description:
      "Delete all Pterodactyl servers.",
  },

  async (from, Gifted, conText) => {
    const {
      reply,
      react,
      isSuperUser,
    } = conText;

    if (!isSuperUser) {
      return reply(
        "❌ *Owner Only Command!*"
      );
    }

    try {
      const servers = await getServers();

      if (!servers.length) {
        return reply(
          "✅ No servers to delete."
        );
      }

      for (const server of servers) {
        await deleteServer(server.attributes.id);
      }

      await reply(
        `✅ *All Servers Deleted*\n\nTotal: ${servers.length} servers`
      );

      await react("🗑️");

    } catch (error) {
      return reply(
        `❌ Error:\n${panelError(error)}`
      );
    }
  }
);
/* ============================================================
 * ❌ DELETE USER
 * ============================================================
 */

gmd(
  {
    pattern: "deluser",
    react: "🗑️",
    category: "cpanel",
    description:
      "Delete Pterodactyl user.",
  },

  async (from, Gifted, conText) => {
    const {
      q,
      reply,
      react,
      botPrefix,
    } = conText;

    const email =
      cleanEmail(q);

    if (!email) {
      return reply(
        `❌ Usage:\n${botPrefix}deleteuser user@example.com`
      );
    }

    try {
      const user =
        await deletePanelUser(
          email
        );

      await reply(
        `🗑️ *User Deleted*\n\n📧 ${user.attributes.email}\n🆔 ${user.attributes.id}`
      );

      await react("✅");

    } catch (error) {
      return reply(
        `❌ Error:\n${panelError(error)}`
      );
    }
  }
);


/* ============================================================
 * 🖥️ LIST SERVERS
 * ============================================================
 */

gmd(
  {
    pattern: "listpanels",
    aliases: ["servers"],
    react: "🖥️",
    category: "cpanel",
    description:
      "List Pterodactyl servers.",
  },

  async (from, Gifted, conText) => {
    const {
      reply,
      react,
    } = conText;

    try {
      const servers =
        await getServers();

      if (!servers.length) {
        return reply(
          "📭 No servers found."
        );
      }

      let text =
        `╭─⌈ *🖥️ SERVERS* ⌋\n`;

      servers.forEach(
        (item, index) => {
          const s =
            item.attributes;

          text +=
            `┃ ${index + 1}. ${s.name}\n` +
            `┃    🆔 ${s.id}\n` +
            `┃    UUID: ${s.uuid}\n` +
            `┃    📊 ${s.status || "active"}\n`;
        }
      );

      text +=
        `╰─⧭⊷\n\n` +
        `Total: ${servers.length}`;

      await reply(text);

      await react("✅");

    } catch (error) {
      return reply(
        `❌ Error:\n${panelError(error)}`
      );
    }
  }
);


/* ============================================================
 * 🔢 TOTAL SERVERS
 * ============================================================
 */

gmd(
  {
    pattern: "totalpanels",
    aliases: ["totalservers"],
    react: "🔢",
    category: "cpanel",
    description:
      "Show total Pterodactyl servers.",
  },

  async (from, Gifted, conText) => {
    const {
      reply,
      react,
    } = conText;

    try {
      const result =
        await panelRequest(
          "GET",
          "/servers",
          undefined,
          {
            per_page: 1,
          }
        );

      const total =
        result.meta?.pagination?.total ||
        result.data?.length ||
        0;

      await reply(
        `🖥️ *Total Servers:* ${total}`
      );

      await react("✅");

    } catch (error) {
      return reply(
        `❌ Error:\n${panelError(error)}`
      );
    }
  }
);


/* ============================================================
 * 🖥️ CREATE PANEL
 * ============================================================
 */

gmd(
  {
    pattern: "createpanel",
    aliases: ["creates", "crpanel"],
    react: "🖥️",
    category: "cpanel",
    description:
      "Create limited Pterodactyl server.",
  },

  async (from, Gifted, conText) => {
    const {
      q,
      reply,
      react,
      botPrefix,
    } = conText;

    const email =
      cleanEmail(q);

    if (!email) {
      return reply(
        `❌ Usage:\n${botPrefix}createpanel user@example.com`
      );
    }

    try {
let user = await findUser(email);
let generatedPassword = null;

if (!user) {
  const created =
    await createPanelUser(email);

  if (!created?.user?.id) {
    throw new Error(
      "User created but Pterodactyl did not return User ID."
    );
  }

  generatedPassword =
    created.password || null;

  /*
   * Fetch user again so we get the
   * real Pterodactyl user object.
   */

  user =
    await findUser(email);

  if (!user) {
    throw new Error(
      "User created but no longer available on Pterodactyl."
    );
  }
}

const result =
  await createPanelServer({
    email,
    unlimited: false,
  });

      const s =
        result.server;

      const allocation =
        result.allocation;

      const text = `
╭─⌈ *🖥️ SERVER CREATED* ⌋
┃
┃ 👤 User: ${result.user.email}
┃ 🖥️ Name: ${s.name}
┃ 🆔 Server ID: ${s.id}
┃ 🌐 IP: ${allocation.ip}
┃ 🔌 Port: ${allocation.port}
┃
┃ ⚙️ CPU: ${cpanelSettings.cpu}%
┃ 🧠 RAM: ${formatMB(cpanelSettings.ram)}
┃ 💾 Disk: ${formatMB(cpanelSettings.disk)}
┃
╰─⧭⊷
`.trim();

      await reply(text);

      await react("✅");

    } catch (error) {
      return reply(
        `❌ Create Panel Failed:\n${panelError(error)}`
      );
    }
  }
);


/* ============================================================
 * ♾️ CREATE UNLIMITED
 * ============================================================
 */

gmd(
  {
    pattern: "createunlimited",
    aliases: ["createunli", "unlimited"],
    react: "♾️",
    category: "cpanel",
    description:
      "Create unlimited Pterodactyl server.",
  },

  async (from, Gifted, conText) => {
    const {
      q,
      reply,
      react,
      botPrefix,
    } = conText;

    const email =
      cleanEmail(q);

    if (!email) {
      return reply(
        `❌ Usage:\n${botPrefix}createunlimited user@example.com`
      );
    }

    try {
      let user =
        await findUser(email);

      if (!user) {
        const created =
          await createPanelUser(email);

        user = {
          attributes:
            created.user,
        };
      }

      const result =
        await createPanelServer({
          email,
          unlimited: true,
        });

      const s =
        result.server;

      const allocation =
        result.allocation;

      await reply(`
╭─⌈ *♾️ UNLIMITED SERVER* ⌋
┃
┃ 📧 ${result.user.email}
┃ 🖥️ ${s.name}
┃ 🆔 ${s.id}
┃ 🌐 ${allocation.ip}
┃ 🔌 ${allocation.port}
┃
┃ ⚙️ CPU: Unlimited
┃ 🧠 RAM: Unlimited
┃ 💾 Disk: Unlimited
┃
╰─⧭⊷
`.trim());

      await react("♾️");

    } catch (error) {
      return reply(
        `❌ Error:\n${panelError(error)}`
      );
    }
  }
);


/* ============================================================
 * 🗑️ DELETE PANEL
 * ============================================================
 */
 gmd(
  {
    pattern: "deletepanel",
    aliases: ["deleteserver", "delpanel"],
    react: "🗑️",
    category: "cpanel",
    description:
      "Delete a Pterodactyl server.",
  },

  async (from, Gifted, conText) => {
    const {
      q,
      reply,
      react,
      botPrefix,
    } = conText;

    const id =
      String(q || "").trim();

    if (!id) {
      return reply(
        `❌ Usage:\n${botPrefix}deletepanel <server-id>`
      );
    }

    try {
      await deleteServer(id);

      await reply(
        `🗑️ *Server Deleted Successfully*\n\n🆔 Server ID: ${id}`
      );

      await react("✅");

    } catch (error) {
      return reply(
        `❌ Error:\n${panelError(error)}`
      );
    }
  }
);


/* ============================================================
 * 🏗️ NEST CONFIG
 * ============================================================
 */

gmd(
  {
    pattern: "nestconfig",
    aliases: ["nest", "config"],
    react: "🏗️",
    category: "cpanel",
    description:
      "Configure Pterodactyl Nest, Egg, Node and resources.",
  },

  async (from, Gifted, conText) => {
    const {
      q,
      reply,
      react,
      botPrefix,
      isSuperUser,
    } = conText;

    if (!isSuperUser) {
      return reply(
        "❌ *Owner Only Command!*"
      );
    }

    const args =
      String(q || "")
        .trim()
        .split(/\s+/);

    const action =
      args[0]?.toLowerCase();

    try {

      /* ===============================
       * SHOW CONFIG
       * ===============================
       */

      if (!q) {
        return reply(`
╭─⌈ *🏗️ NEST CONFIG* ⌋
┃
┃ 🪺 Nest: ${cpanelSettings.nest || "Not Set"}
┃ 🥚 Egg: ${cpanelSettings.egg || "Not Set"}
┃ 🖥️ Node: ${cpanelSettings.node || "Not Set"}
┃ 📍 Location: ${cpanelSettings.location || "Not Set"}
┃
┃ ⚙️ CPU: ${cpanelSettings.cpu}%
┃ 🧠 RAM: ${formatMB(cpanelSettings.ram)}
┃ 💾 Disk: ${formatMB(cpanelSettings.disk)}
┃
╰─⧭⊷

Examples:
${botPrefix}nestconfig nests
${botPrefix}nestconfig eggs 1
${botPrefix}nestconfig nodes
${botPrefix}nestconfig locations
${botPrefix}nestconfig nest 1
${botPrefix}nestconfig egg 15
${botPrefix}nestconfig node 1
${botPrefix}nestconfig location 1
${botPrefix}nestconfig cpu 100
${botPrefix}nestconfig ram 1024
${botPrefix}nestconfig disk 5000
`.trim());
      }


      /* ===============================
       * NESTS
       * ===============================
       */

      if (action === "nests") {
        const nests =
          await getNests();

        if (!nests.length) {
          return reply(
            "📭 No nests found."
          );
        }

        let text =
          "╭─⌈ *🏗️ NESTS* ⌋\n";

        nests.forEach(
          (item) => {
            const n =
              item.attributes;

            text +=
              `┃ 🆔 ${n.id}\n` +
              `┃ 📦 ${n.name}\n` +
              `┃ 🔹 ${n.slug}\n\n`;
          }
        );

        text +=
          "╰─⧭⊷";

        return reply(text);
      }


      /* ===============================
       * EGGS
       * ===============================
       */

      if (action === "eggs") {
        const nestId =
          Number(args[1]);

        if (!nestId) {
          return reply(
            `❌ Example:\n${botPrefix}nestconfig eggs 1`
          );
        }

        const eggs =
          await getEggs(nestId);

        if (!eggs.length) {
          return reply(
            "📭 No eggs found."
          );
        }

        let text =
          `╭─⌈ *🥚 EGGS — NEST ${nestId}* ⌋\n`;

        eggs.forEach(
          (item) => {
            const e =
              item.attributes;

            text +=
              `┃ 🆔 ${e.id}\n` +
              `┃ 🥚 ${e.name}\n` +
              `┃ 🔹 ${e.slug}\n\n`;
          }
        );

        text +=
          "╰─⧭⊷";

        return reply(text);
      }


      /* ===============================
       * NODES
       * ===============================
       */

      if (action === "nodes") {
        const nodes =
          await getNodes();

        if (!nodes.length) {
          return reply(
            "📭 No nodes found."
          );
        }

        let text =
          "╭─⌈ *🖥️ NODES* ⌋\n";

        nodes.forEach(
          (item) => {
            const n =
              item.attributes;

            text +=
              `┃ 🆔 ${n.id}\n` +
              `┃ 🖥️ ${n.name}\n` +
              `┃ 🌐 ${n.fqdn}\n` +
              `┃ 📍 Location: ${n.location_id}\n\n`;
          }
        );

        text +=
          "╰─⧭⊷";

        return reply(text);
      }


      /* ===============================
       * LOCATIONS
       * ===============================
       */

      if (
        action === "locations" ||
        action === "locationlist"
      ) {
        const locations =
          await getLocations();

        if (!locations.length) {
          return reply(
            "📭 No locations found."
          );
        }

        let text =
          "╭─⌈ *📍 LOCATIONS* ⌋\n";

        locations.forEach(
          (item) => {
            const l =
              item.attributes;

            text +=
              `┃ 🆔 ${l.id}\n` +
              `┃ 📍 ${l.short}\n` +
              `┃ 📝 ${l.long}\n\n`;
          }
        );

        text +=
          "╰─⧭⊷";

        return reply(text);
      }


      /* ===============================
       * SET VALUES
       * ===============================
       */

      const value =
        args.slice(1).join(" ").trim();

      if (!value) {
        return reply(
          "❌ Missing value."
        );
      }


      if (action === "nest") {
        cpanelSettings.nest =
          Number(value);
      }


      else if (action === "egg") {
        cpanelSettings.egg =
          Number(value);
      }


      else if (action === "node") {
        cpanelSettings.node =
          Number(value);
      }


      else if (action === "location") {
        cpanelSettings.location =
          Number(value);
      }


      else if (action === "cpu") {
        cpanelSettings.cpu =
          Number(value);
      }


      else if (action === "ram") {
        cpanelSettings.ram =
          Number(value);
      }


      else if (action === "disk") {
        cpanelSettings.disk =
          Number(value);
      }


      else {
        return reply(
          `❌ Unknown option: ${action}`
        );
      }


      await reply(`
✅ *NEST CONFIG UPDATED*

⚙️ Setting: ${action}
📌 Value: ${value}
`.trim());

      await react("✅");

    } catch (error) {
      console.error(error);

      return reply(
        `❌ NestConfig Error:\n${panelError(error)}`
      );
    }
  }
);


/* ============================================================
 * 🔧 SET PTERODACTYL URL
 * ============================================================
 */

gmd(
  {
    pattern: "setlink",
    aliases: ["setptero", "setpanel"],
    react: "🔧",
    category: "cpanel",
    description:
      "Show how to set Pterodactyl panel URL.",
  },

  async (from, Gifted, conText) => {
    const {
      q,
      reply,
      react,
      isSuperUser,
    } = conText;

    if (!isSuperUser) {
      return reply(
        "❌ *Owner Only Command!*"
      );
    }

    const url = String(q || "").trim();

    if (!url) {
      return reply(`
━━━[* ⚙️  PTERODACTYL URL SETUP *]━━━

📝 To set your Pterodactyl panel URL, add this to your .env file:

PTERODACTYL_URL=https://your-panel.com

⚠️ Then restart your bot.

━━━━━━━━━━━━━━━━━━━━━━━━━━━

Usage example:
.setlink https://panel.example.com
`.trim());
    }

    try {
      const cleanUrl = url.replace(/\/+$/, "");

      const text = `
━━━[* ✅ PTERODACTYL URL *]━━━

🔗 URL: ${cleanUrl}

━━━[* 📌 ADD TO .ENV FILE *]━━━

PTERODACTYL_URL=${cleanUrl}

⚠️ Save the file and restart your bot.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

      await reply(text);
      await react("✅");

    } catch (error) {
      return reply(
        `❌ Error:\n${panelError(error)}`
      );
    }
  }
);


/* ============================================================
 * 🔑 SET PTERODACTYL API KEY
 * ============================================================
 */

gmd(
  {
    pattern: "setkey",
    aliases: ["setapikey", "setapi"],
    react: "🔑",
    category: "cpanel",
    description:
      "Show how to set Pterodactyl Application API key.",
  },

  async (from, Gifted, conText) => {
    const {
      q,
      reply,
      react,
      isSuperUser,
    } = conText;

    if (!isSuperUser) {
      return reply(
        "❌ *Owner Only Command!*"
      );
    }

    const apiKey = String(q || "").trim();

    if (!apiKey) {
      return reply(`
━━━[* 🗝️  API KEY SETUP *]━━━

📝 To set your Pterodactyl API key, add this to your .env file:

PTERODACTYL_API_KEY=ptla_xxxxxxxxxxxxxxxxxxxxxx

⚠️ Then restart your bot.

📌 Application API Keys start with "ptla_"
📌 Client API Keys start with "ptlc_" (not supported)

━━━━━━━━━━━━━━━━━━━━━━━━━━━

Usage example:
.setkey ptla_xxxxxxxxxxxxxxxxxxxxxx
`.trim());
    }

    if (!apiKey.startsWith("ptla_")) {
      return reply(
        "❌ Invalid API key format.\n\nApplication API keys start with `ptla_` not `ptlc_`"
      );
    }

    try {
      const text = `
━━━[* ✅ API KEY SAVED *]━━━

🔑 Key: ${apiKey.substring(0, 20)}...

━━━[* 📌 ADD TO .ENV FILE *]━━━

PTERODACTYL_API_KEY=${apiKey}

⚠️ Save the file and restart your bot.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

      await reply(text);
      await react("✅");

    } catch (error) {
      return reply(
        `❌ Error:\n${panelError(error)}`
      );
    }
  }
);


/* ============================================================
 * 👁️ VIEW SAVED API KEY
 * ============================================================
 */

gmd(
  {
    pattern: "mysetkey",
    aliases: ["viewkey", "showkey"],
    react: "👁️",
    category: "cpanel",
    description:
      "View saved Pterodactyl API key.",
  },

  async (from, Gifted, conText) => {
    const {
      reply,
      react,
      isSuperUser,
    } = conText;

    if (!isSuperUser) {
      return reply(
        "❌ *Owner Only Command!*"
      );
    }

    const key = PANEL_API_KEY;

    if (!key) {
      return reply(`
❌ No API key found in .env

━━━[* 📌 HOW TO ADD *]━━━

1. Open your .env file
2. Add this line:
   PTERODACTYL_API_KEY=ptla_xxxxxxxxxx

3. Save and restart your bot

━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim());
    }

    await reply(`
━━━[* 🗝️  SAVED API KEY *]━━━

🔑 ${key.substring(0, 25)}${key.length > 25 ? "..." : ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim().trim());

    await react("✅");
  }
);



/* ============================================================
 * 💳 SET PAYSTACK KEY
 *
 * NOTE:
 * Secret key is expected from ENV.
 * This command only tells you its status.
 * ============================================================
 */
 gmd(
  {
    pattern: "setpaystackkey",
    react: "💳",
    category: "cpanel",
    description:
      "Check Paystack secret key configuration.",
  },

  async (from, Gifted, conText) => {
    const {
      reply,
      react,
      isSuperUser,
    } = conText;

    if (!isSuperUser) {
      return reply(
        "❌ *Owner Only Command!*"
      );
    }

    if (!PAYSTACK_SECRET_KEY) {
      return reply(
        "❌ Paystack The key is missing from the ENV.\n\n" +
        "Weka:\n" +
        "PAYSTACK_SECRET_KEY=sk_live_xxxxx\n\n" +
        "kisha restart bot."
      );
    }

    return reply(
      "✅ *Paystack Secret Key is configured in ENV.*"
    );
  }
);


/* ============================================================
 * 💳 PROMPT
 *
 * Example:
 *
 * .prompt 254700000000 user@gmail.com unlimited
 *
 * This initializes a Paystack transaction.
 * ============================================================
 */

gmd(
  {
    pattern: "prompt",
    aliases: ["pay", "payment"],
    react: "💳",
    category: "cpanel",
    description:
      "Initialize CPanel Paystack payment.",
  },

  async (from, Gifted, conText) => {
    const {
      q,
      reply,
      react,
      botPrefix,
    } = conText;

    const args =
      String(q || "")
        .trim()
        .split(/\s+/);

    if (args.length < 3) {
      return reply(`
❌ *Invalid Usage*

Example:

${botPrefix}prompt 254700000000 user@example.com unlimited

Plans:
• unlimited
• limited
• admin
`.trim());
    }

    const phone =
      args[0];

    const email =
      cleanEmail(args[1]);

    const plan =
      args[2].toLowerCase();

    let amount;

    if (plan === "unlimited") {
      amount =
        cpanelSettings.unlimitedPrice;
    }

    else if (plan === "limited") {
      amount =
        cpanelSettings.limitedPrice;
    }

    else if (plan === "admin") {
      amount =
        cpanelSettings.adminPrice;
    }

    else {
      return reply(
        "❌ Plan invalid.\n\nUse: unlimited, limited, admin"
      );
    }

    try {
      const payment =
        await initializePayment({
          email,
          amount,
          metadata: {
            phone,
            plan,
            source: "BLACK_HAT",
          },
        });

      await sendButtons(
        Gifted,
        from,
        {
          title:
            "💳 Payment Created",

          text: `
╭─⌈ *💳 CPANEL PAYMENT* ⌋
┃
┃ 📧 Email: ${email}
┃ 📱 Phone: ${phone}
┃ 📦 Plan: ${plan}
┃ 💰 Amount: ${amount} ${CURRENCY}
┃
┃ Status: Pending
┃
╰─⧭⊷
`.trim(),

          buttons: [
            {
              name: "cta_url",

              buttonParamsJson:
                JSON.stringify({
                  display_text:
                    "💳 Pay Now",

                  url:
                    payment.authorization_url,
                }),
            },

            {
              name: "cta_copy",

              buttonParamsJson:
                JSON.stringify({
                  display_text:
                    "📋 Copy Reference",

                  copy_code:
                    payment.reference,
                }),
            },
          ],
        }
      );

      await react("💳");

    } catch (error) {
      return reply(
        `❌ Payment Error:\n${panelError(error)}`
      );
    }
  }
);


/* ============================================================
 * EXPORT
 *
 * Commands are registered automatically by gmd().
 * ============================================================
 */

module.exports = {
  cpanelSettings,

  panelRequest,

  createPanelUser,

  createPanelServer,

  getNests,

  getEggs,

  getNodes,

  getLocations,

  getServers,
};