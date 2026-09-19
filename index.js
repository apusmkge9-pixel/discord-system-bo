// Arabic Discord bot: welcome image + auto role + tickets + moderation + basic anti-spam
// Required Render env vars: DISCORD_TOKEN, CLIENT_ID, GUILD_ID
// Optional: WELCOME_CHANNEL_ID, MEMBER_ROLE_ID, STAFF_ROLE_ID, TICKET_CATEGORY_ID,
//           TICKET_SUPPORT_ROLE_ID, TICKET_SHOP_ROLE_ID, LOG_CHANNEL_ID
// Set IDs as Discord Developer Mode > right-click/copy ID.
// Never share your bot token.

const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, AttachmentBuilder, Events
} = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const {
  DISCORD_TOKEN, CLIENT_ID, GUILD_ID,
  WELCOME_CHANNEL_ID, MEMBER_ROLE_ID, STAFF_ROLE_ID,
  TICKET_CATEGORY_ID, TICKET_SUPPORT_ROLE_ID, TICKET_SHOP_ROLE_ID,
  LOG_CHANNEL_ID
} = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing required environment variables: DISCORD_TOKEN, CLIENT_ID, GUILD_ID');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// In-memory anti-spam state (resets when the service restarts).
const recentMessages = new Map();
const mutedUntil = new Map();

const commands = [
  new SlashCommandBuilder().setName('setup-tickets').setDescription('إرسال لوحة فتح التذاكر').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('balance').setDescription('عرض رصيد الكريدت التجريبي'),
  new SlashCommandBuilder().setName('daily').setDescription('استلام 100 كريدت تجريبي يومياً'),
  new SlashCommandBuilder().setName('shop').setDescription('عرض أسعار الرتب'),
  new SlashCommandBuilder().setName('buy').setDescription('شراء رتبة بالكريدت')
    .addStringOption(o => o.setName('role').setDescription('الرتبة').setRequired(true)
      .addChoices({name:'VIP',value:'vip'},{name:'Gamer',value:'gamer'})),
  new SlashCommandBuilder().setName('clear').setDescription('حذف رسائل').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o=>o.setName('amount').setDescription('من 1 إلى 100').setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName('kick').setDescription('طرد عضو').setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o=>o.setName('member').setDescription('العضو').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('السبب')),
  new SlashCommandBuilder().setName('ban').setDescription('حظر عضو').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o=>o.setName('member').setDescription('العضو').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('السبب')),
  new SlashCommandBuilder().setName('timeout').setDescription('إسكات عضو مؤقتاً').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o=>o.setName('member').setDescription('العضو').setRequired(true))
    .addIntegerOption(o=>o.setName('minutes').setDescription('المدة بالدقائق (1-40320)').setMinValue(1).setMaxValue(40320).setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('السبب')),
  new SlashCommandBuilder().setName('warn').setDescription('إرسال تنبيه لعضو').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o=>o.setName('member').setDescription('العضو').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('السبب').setRequired(true)),
  new SlashCommandBuilder().setName('lock').setDescription('قفل الروم الحالي').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('unlock').setDescription('فتح الروم الحالي').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('help').setDescription('عرض أوامر البوت')
].map(c=>c.toJSON());

const balances = new Map();
const dailyClaims = new Map();
const ROLE_PRICES = { vip: 1000, gamer: 500 };
// Configure role IDs here (or use the optional environment variables).
const SHOP_ROLE_IDS = { vip: process.env.VIP_ROLE_ID, gamer: process.env.GAMER_ROLE_ID };

async function logToGuild(guild, text) {
  if (!LOG_CHANNEL_ID) return;
  const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (ch?.isTextBased()) ch.send({embeds:[new EmbedBuilder().setColor(0x5865F2).setDescription(text).setTimestamp()]}).catch(()=>{});
}

async function makeWelcomeImage(member) {
  const canvas = createCanvas(1000, 360);
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0,0,1000,360);
  grad.addColorStop(0,'#17152d'); grad.addColorStop(1,'#3b1d69');
  ctx.fillStyle=grad; ctx.fillRect(0,0,1000,360);
  ctx.fillStyle='rgba(255,255,255,0.08)';
  for(let i=0;i<18;i++){ctx.beginPath();ctx.arc((i*137)%1000,(i*83)%360,20+(i%4)*13,0,Math.PI*2);ctx.fill();}
  ctx.textAlign='center';
  ctx.fillStyle='#ffffff'; ctx.font='bold 48px sans-serif'; ctx.fillText('أهلاً وسهلاً بك',500,75);
  ctx.font='bold 35px sans-serif'; ctx.fillText(member.user.username.slice(0,28),500,285);
  ctx.font='26px sans-serif'; ctx.fillStyle='#e0d8ff'; ctx.fillText(`أنت العضو رقم ${member.guild.memberCount}`,500,330);
  try {
    const avatar = await loadImage(member.user.displayAvatarURL({extension:'png',size:256}));
    ctx.save(); ctx.beginPath(); ctx.arc(500,180,82,0,Math.PI*2); ctx.closePath(); ctx.clip();
    ctx.drawImage(avatar,418,98,164,164); ctx.restore();
    ctx.strokeStyle='#ffffff';ctx.lineWidth=8;ctx.beginPath();ctx.arc(500,180,85,0,Math.PI*2);ctx.stroke();
  } catch(e) { console.warn('Could not load avatar:',e.message); }
  return new AttachmentBuilder(await canvas.encode('png'),{name:'welcome.png'});
}

client.once(Events.ClientReady, async c => {
  console.log(`Bot online as ${c.user.tag}`);
  try {
    const rest = new REST({version:'10'}).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID),{body:commands});
    console.log('Slash commands registered.');
  } catch(err) { console.error('Command registration failed:',err); }
});

client.on(Events.GuildMemberAdd, async member => {
  try {
    if (MEMBER_ROLE_ID) {
      const role = member.guild.roles.cache.get(MEMBER_ROLE_ID);
      if (role) await member.roles.add(role).catch(err=>console.error('Auto role failed:',err.message));
    }
    if (WELCOME_CHANNEL_ID) {
      const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
      if (channel?.isTextBased()) {
        const image = await makeWelcomeImage(member);
        await channel.send({content:`🎉 أهلاً ${member} نورت السيرفر!`,files:[image]});
      }
    }
    await logToGuild(member.guild,`🟢 انضم ${member.user.tag} (${member.id})`);
  } catch(err) { console.error('Welcome/role error:',err); }
});

client.on(Events.GuildMemberRemove, member => {
  logToGuild(member.guild,`🔴 غادر ${member.user.tag}`);
});

client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot || !message.member) return;
  const now=Date.now(), key=`${message.guild.id}:${message.author.id}`;
  const arr=(recentMessages.get(key)||[]).filter(t=>now-t<7000);
  arr.push(now); recentMessages.set(key,arr);
  if(arr.length>=6 && !message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await message.delete().catch(()=>{});
    await message.member.timeout(60_000,'Anti-spam: too many messages').catch(()=>{});
    await logToGuild(message.guild,`⚠️ تم تقييد ${message.author.tag} دقيقة بسبب الرسائل المتكررة.`);
    recentMessages.set(key,[]);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const {commandName}=interaction;
      if(commandName==='help') {
        return interaction.reply({ephemeral:true,embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle('أوامر البوت')
          .setDescription('**التذاكر:** `/setup-tickets`\n**الكريدت التجريبي:** `/balance` `/daily` `/shop` `/buy`\n**الإدارة:** `/clear` `/kick` `/ban` `/timeout` `/warn` `/lock` `/unlock`')]});
      }
      if(commandName==='setup-tickets') {
        const embed=new EmbedBuilder().setColor(0x5865F2).setTitle('🎫 مركز الدعم').setDescription('اختار نوع التذكرة من القائمة أدناه، وسيتم فتح روم خاص لك مع فريق الدعم.');
        const menu=new StringSelectMenuBuilder().setCustomId('ticket_type').setPlaceholder('اختار نوع التذكرة')
          .addOptions({label:'الدعم الفني',value:'support',emoji:'🛠️',description:'مشكلة أو استفسار'},
                      {label:'المتجر والرتب',value:'shop',emoji:'🛒',description:'شراء أو استفسار عن الرتب'},
                      {label:'شكوى للإدارة',value:'staff',emoji:'🛡️',description:'التواصل مع الإدارة'});
        return interaction.reply({content:'تم إنشاء لوحة التذاكر.',ephemeral:true}).then(()=>interaction.channel.send({embeds:[embed],components:[new ActionRowBuilder().addComponents(menu)]}));
      }
      if(commandName==='balance') {
        const bal=balances.get(interaction.user.id)||0;
        return interaction.reply({content:`💰 رصيدك التجريبي: **${bal} كريدت**`,ephemeral:true});
      }
      if(commandName==='daily') {
        const last=dailyClaims.get(interaction.user.id)||0;
        if(Date.now()-last<86400000) return interaction.reply({content:'⏳ استلمت مكافأتك اليوم. ارجع بعد 24 ساعة.',ephemeral:true});
        dailyClaims.set(interaction.user.id,Date.now());
        balances.set(interaction.user.id,(balances.get(interaction.user.id)||0)+100);
        return interaction.reply({content:'🎁 استلمت 100 كريدت تجريبي!',ephemeral:true});
      }
      if(commandName==='shop') return interaction.reply({content:`🛍️ **المتجر**\nVIP: ${ROLE_PRICES.vip} كريدت\nGamer: ${ROLE_PRICES.gamer} كريدت\nاستخدم \`/buy role:VIP\` أو \`/buy role:Gamer\`.`,ephemeral:true});
      if(commandName==='buy') {
        const which=interaction.options.getString('role');
        const roleId=SHOP_ROLE_IDS[which], price=ROLE_PRICES[which];
        if(!roleId) return interaction.reply({content:`لم يتم ضبط آيدي رتبة ${which} بعد. أضف ${which.toUpperCase()}_ROLE_ID في Render Environment.`,ephemeral:true});
        const bal=balances.get(interaction.user.id)||0;
        if(bal<price) return interaction.reply({content:`رصيدك ${bal}، تحتاج ${price} كريدت.`,ephemeral:true});
        const role=interaction.guild.roles.cache.get(roleId);
        if(!role) return interaction.reply({content:'الرتبة غير موجودة. تحقق من آيدي الرتبة.',ephemeral:true});
        await interaction.member.roles.add(role);
        balances.set(interaction.user.id,bal-price);
        return interaction.reply({content:`✅ تم شراء رتبة ${role.name} وخصم ${price} كريدت. (الرصيد التجريبي لا يُحفظ بعد إعادة تشغيل البوت)`,ephemeral:true});
      }
      if(commandName==='clear') {
        const amount=interaction.options.getInteger('amount');
        const deleted=await interaction.channel.bulkDelete(amount,true);
        return interaction.reply({content:`🧹 تم حذف ${deleted.size} رسالة.`,ephemeral:true});
      }
      if(['kick','ban','timeout','warn'].includes(commandName)) {
        const user=interaction.options.getUser('member');
        const member=await interaction.guild.members.fetch(user.id).catch(()=>null);
        const reason=interaction.options.getString('reason')||'لم يُذكر سبب';
        if(!member) return interaction.reply({content:'ما لكيت العضو بالسيرفر.',ephemeral:true});
        if(user.id===interaction.user.id) return interaction.reply({content:'ما تگدر تطبق الإجراء على نفسك.',ephemeral:true});
        if(commandName==='warn') {
          await user.send(`⚠️ تم تحذيرك في ${interaction.guild.name}. السبب: ${reason}`).catch(()=>{});
          await logToGuild(interaction.guild,`⚠️ تحذير ${user.tag} بواسطة ${interaction.user.tag}. السبب: ${reason}`);
          return interaction.reply({content:`تم إرسال التحذير إلى ${user.tag}.`,ephemeral:true});
        }
        if(member.id===interaction.guild.ownerId || member.roles.highest.position>=interaction.member.roles.highest.position)
          return interaction.reply({content:'ما تگدر تطبق الإجراء على عضو رتبته مساوية أو أعلى من رتبتك.',ephemeral:true});
        if(commandName==='kick') await member.kick(reason);
        if(commandName==='ban') await member.ban({reason});
        if(commandName==='timeout') await member.timeout(interaction.options.getInteger('minutes')*60000,reason);
        await logToGuild(interaction.guild,`🛡️ ${commandName} على ${user.tag} بواسطة ${interaction.user.tag}. السبب: ${reason}`);
        return interaction.reply({content:`✅ تم تنفيذ ${commandName} على ${user.tag}.`,ephemeral:true});
      }
      if(commandName==='lock' || commandName==='unlock') {
        const everyone=interaction.guild.roles.everyone;
        await interaction.channel.permissionOverwrites.edit(everyone,{SendMessages:commandName==='unlock'?null:false});
        return interaction.reply({content:commandName==='lock'?'🔒 تم قفل الروم.':'🔓 تم فتح الروم.',ephemeral:true});
      }
    }

    if(interaction.isStringSelectMenu() && interaction.customId==='ticket_type') {
      await interaction.deferReply({ephemeral:true});
      const type=interaction.values[0], guild=interaction.guild, user=interaction.user;
      const existing=guild.channels.cache.find(ch=>ch.topic===`ticket-owner:${user.id}`);
      if(existing) return interaction.editReply(`عندك تذكرة مفتوحة بالفعل: ${existing}`);
      const safe=user.username.toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,18)||'member';
      const channel=await guild.channels.create({
        name:`${type}-${safe}`.slice(0,90), type:ChannelType.GuildText,
        parent:TICKET_CATEGORY_ID||undefined, topic:`ticket-owner:${user.id}`,
        permissionOverwrites:[
          {id:guild.roles.everyone.id,deny:[PermissionFlagsBits.ViewChannel]},
          {id:user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles]},
          {id:client.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]},
          ...(TICKET_SUPPORT_ROLE_ID?[{id:TICKET_SUPPORT_ROLE_ID,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}]:[]),
          ...(type==='shop'&&TICKET_SHOP_ROLE_ID?[{id:TICKET_SHOP_ROLE_ID,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}]:[]),
          ...(STAFF_ROLE_ID?[{id:STAFF_ROLE_ID,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}]:[])
        ]
      });
      const close=new ButtonBuilder().setCustomId('ticket_close').setLabel('إغلاق التذكرة').setEmoji('🔒').setStyle(ButtonStyle.Danger);
      const claim=new ButtonBuilder().setCustomId('ticket_claim').setLabel('استلام التذكرة').setEmoji('🛠️').setStyle(ButtonStyle.Primary);
      await channel.send({content:`${user} أهلاً بك! نوع التذكرة: **${type}**\nاشرح طلبك هنا وسيجيبك فريق الدعم.`,components:[new ActionRowBuilder().addComponents(claim,close)]});
      return interaction.editReply(`✅ تم فتح تذكرتك: ${channel}`);
    }

    if(interaction.isButton() && interaction.customId==='ticket_claim') {
      if(!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) && !(STAFF_ROLE_ID&&interaction.member.roles.cache.has(STAFF_ROLE_ID)) && !(TICKET_SUPPORT_ROLE_ID&&interaction.member.roles.cache.has(TICKET_SUPPORT_ROLE_ID)))
        return interaction.reply({content:'هذا الزر لفريق الدعم فقط.',ephemeral:true});
      await interaction.channel.setTopic(`${interaction.channel.topic||''} | claimed:${interaction.user.id}`);
      return interaction.reply({content:`🛠️ استلم ${interaction.user} التذكرة.`});
    }
    if(interaction.isButton() && interaction.customId==='ticket_close') {
      const ownerId=(interaction.channel.topic||'').match(/ticket-owner:(\d+)/)?.[1];
      const allowed=interaction.user.id===ownerId || interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) || (STAFF_ROLE_ID&&interaction.member.roles.cache.has(STAFF_ROLE_ID)) || (TICKET_SUPPORT_ROLE_ID&&interaction.member.roles.cache.has(TICKET_SUPPORT_ROLE_ID));
      if(!allowed) return interaction.reply({content:'إغلاق التذكرة لصاحبها أو فريق الدعم فقط.',ephemeral:true});
      await interaction.reply({content:'🔒 سيتم إغلاق التذكرة بعد 5 ثوانٍ.'});
      setTimeout(()=>interaction.channel.delete().catch(()=>{}),5000);
    }
  } catch(err) {
    console.error('Interaction error:',err);
    const payload={content:'❌ صار خطأ. تحقق من صلاحيات البوت وإعداداته.',ephemeral:true};
    if(interaction.isRepliable()) {
      if(interaction.deferred || interaction.replied) interaction.followUp(payload).catch(()=>{});
      else interaction.reply(payload).catch(()=>{});
    }
  }
});

client.login(DISCORD_TOKEN);
