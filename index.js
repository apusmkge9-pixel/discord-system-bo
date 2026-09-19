const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  WELCOME_CHANNEL_ID,
  MEMBER_ROLE_ID,
  STAFF_ROLE_ID
} = process.env;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.GuildMember]
});

const commands = [
  new SlashCommandBuilder()
    .setName("setup-tickets")
    .setDescription("إنشاء لوحة تيكتات الدعم والمشتريات")
].map(command => command.toJSON());

client.once("ready", async () => {
  console.log(`Bot online: ${client.user.tag}`);

  try {
    const rest = new REST({ version: "10" })
      .setToken(DISCORD_TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log("Slash commands registered.");
  } catch (error) {
    console.error(error);
  }
});

// Welcome + automatic role
client.on("guildMemberAdd", async member => {
  try {
    const role = member.guild.roles.cache.get(MEMBER_ROLE_ID);

    if (role) {
      await member.roles.add(role);
    }

    const channel = member.guild.channels.cache.get(
      WELCOME_CHANNEL_ID
    );

    if (channel) {
      const embed = new EmbedBuilder()
        .setColor("#8b5cf6")
        .setTitle("👋 أهلاً وسهلاً بك!")
        .setDescription(
          `نورت السيرفر ${member} 💜\n` +
          "نتمنى لك وقت ممتع ويانا!\n" +
          "لا تنسى تقرأ القوانين."
        )
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: "Welcome to our community" })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error("Welcome error:", error);
  }
});

// Ticket panel and ticket creation
client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "setup-tickets") {
        if (
          !interaction.memberPermissions.has(
            PermissionsBitField.Flags.ManageGuild
          )
        ) {
          return interaction.reply({
            content: "❌ هذا الأمر للإدارة فقط.",
            ephemeral: true
          });
        }

        const embed = new EmbedBuilder()
          .setColor("#7c3aed")
          .setTitle("🎫 مركز الدعم والمساعدة")
          .setDescription(
            "اختار نوع التيكت حتى تتواصل ويه الإدارة.\n\n" +
            "🛠️ **الدعم الفني:** للمشاكل والاستفسارات.\n" +
            "🛒 **المشتريات:** للطلبات والأسعار."
          )
          .setFooter({ text: "Support Center" });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("ticket_support")
            .setLabel("الدعم الفني")
            .setEmoji("🛠️")
            .setStyle(ButtonStyle.Primary),

          new ButtonBuilder()
            .setCustomId("ticket_shop")
            .setLabel("المشتريات")
            .setEmoji("🛒")
            .setStyle(ButtonStyle.Success)
        );

        await interaction.channel.send({
          embeds: [embed],
          components: [row]
        });

        return interaction.reply({
          content: "✅ تم إنشاء لوحة التيكتات.",
          ephemeral: true
        });
      }
    }

    if (!interaction.isButton()) return;

    if (
      interaction.customId === "ticket_support" ||
      interaction.customId === "ticket_shop"
    ) {
      const guild = interaction.guild;
      const member = interaction.member;

      const existing = guild.channels.cache.find(channel =>
        channel.topic === `ticket-owner:${member.id}`
      );

      if (existing) {
        return interaction.reply({
          content: `عندك تيكت مفتوح بالفعل: ${existing}`,
          ephemeral: true
        });
      }

      const isSupport =
        interaction.customId === "ticket_support";

      const channel = await guild.channels.create({
        name: `${isSupport ? "support" : "shop"}-${member.user.username}`
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "")
          .slice(0, 90),
        type: ChannelType.GuildText,
        topic: `ticket-owner:${member.id}`,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
          },
          {
            id: member.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory
            ]
          },
          {
            id: client.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ManageChannels
            ]
          },
          ...(STAFF_ROLE_ID ? [{
            id: STAFF_ROLE_ID,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory
            ]
          }] : [])
        ]
      });

      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket_close")
          .setLabel("إغلاق التيكت")
          .setEmoji("🔒")
          .setStyle(ButtonStyle.Danger)
      );

      const embed = new EmbedBuilder()
        .setColor("#8b5cf6")
        .setTitle(isSupport ? "🛠️ تيكت الدعم الفني" : "🛒 تيكت المشتريات")
        .setDescription(
          `أهلاً ${member}!\n` +
          "اكتب تفاصيل طلبك، والإدارة راح تساعدك."
        )
        .setTimestamp();

      await channel.send({
        content: `${member} ${STAFF_ROLE_ID ? `<@&${STAFF_ROLE_ID}>` : ""}`,
        embeds: [embed],
        components: [closeRow]
      });

      return interaction.reply({
        content: `✅ تم فتح تيكتك: ${channel}`,
        ephemeral: true
      });
    }

    if (interaction.customId === "ticket_close") {
      const topic = interaction.channel.topic || "";
      const ownerId = topic.replace("ticket-owner:", "");

      const isOwner = interaction.user.id === ownerId;
      const isStaff = STAFF_ROLE_ID &&
        interaction.member.roles.cache.has(STAFF_ROLE_ID);

      if (
        !isOwner &&
        !isStaff &&
        !interaction.memberPermissions.has(
          PermissionsBitField.Flags.ManageChannels
        )
      ) {
        return interaction.reply({
          content: "❌ ما عندك صلاحية تغلق هذا التيكت.",
          ephemeral: true
        });
      }

      await interaction.reply("🔒 راح يتم إغلاق التيكت بعد 5 ثواني.");

      setTimeout(() => {
        interaction.channel.delete().catch(console.error);
      }, 5000);
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ صار خطأ، تأكد من صلاحيات البوت والإعدادات.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Missing required environment variables.");
  process.exit(1);
}

client.login(DISCORD_TOKEN);
          
