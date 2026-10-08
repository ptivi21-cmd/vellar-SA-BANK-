const CONFIG = {
  trackedWallet: "UQDpHoPi5JHFruwdiKHCGO68gVaW4lKN0arzTAoMWVDWrjuv",
  saJetton: "EQBW1ZPnrV2LujIKfwdctIy57c5-RFlkxAZDo9-CN5BtTWmC",
  donateWallet: "UQDpHoPi5JHFruwdiKHCGO68gVaW4lKN0arzTAoMWVDWrjuv",
  tonApi: "https://tonapi.io/v2",
  gecko: "https://api.geckoterminal.com/api/v2"
};

let tonUI, chart, selectedAmount = 1;
let sb = null;
let sessionUser = null;
let connectedAddress = null;
const SUPABASE_READY = !!(window.SA_SUPABASE_URL && window.SA_SUPABASE_ANON_KEY &&
  !window.SA_SUPABASE_URL.includes("YOUR-PROJECT") && !window.SA_SUPABASE_ANON_KEY.includes("YOUR-SUPABASE"));
if (SUPABASE_READY) sb = supabase.createClient(window.SA_SUPABASE_URL, window.SA_SUPABASE_ANON_KEY);

const $ = id => document.getElementById(id);
const short = (s,n=8) => s ? `${s.slice(0,n)}…${s.slice(-n)}` : "—";
const fmt = (n,d=2) => Number(n||0).toLocaleString("ru-RU",{maximumFractionDigits:d});

async function api(path){
  const r = await fetch(CONFIG.tonApi + path);
  if(!r.ok) throw new Error(`TON API ${r.status}`);
  return r.json();
}

async function loadPortfolio(){
  try{
    const account = await api(`/accounts/${CONFIG.trackedWallet}`);
    const jettons = await api(`/accounts/${CONFIG.trackedWallet}/jettons`);
    const ton = Number(account.balance || 0) / 1e9;
    $("tonBalance").textContent = `${fmt(ton,3)} TON`;
    $("tonValue").textContent = "native balance";
    $("jettonCount").textContent = jettons.balances?.length ?? 0;
    const sa = (jettons.balances || []).find(x =>
      (x.jetton?.address || "").toLowerCase() === CONFIG.saJetton.toLowerCase()
    );
    const saDecimals = Number(sa?.jetton?.decimals ?? 9);
    const saAmount = sa ? Number(sa.balance) / 10**saDecimals : 0;
    $("saBalance").textContent = `${fmt(saAmount,2)} SA`;
    $("saValue").textContent = sa ? "tracked token" : "no SA balance detected";
    $("updated").textContent = new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});

    const list = $("positionsList");
    const assets = [];
    assets.push({name:"Toncoin",symbol:"TON",balance:ton,decimals:3});
    for(const x of (jettons.balances || [])){
      const decimals = Number(x.jetton?.decimals ?? 9);
      const amount = Number(x.balance) / 10**decimals;
      assets.push({
        name:x.jetton?.name || x.jetton?.symbol || "Jetton",
        symbol:x.jetton?.symbol || "—",
        balance:amount, decimals,
        address:x.jetton?.address || ""
      });
    }
    assets.sort((a,b)=> (b.balance||0)-(a.balance||0));
    list.innerHTML = assets.slice(0,30).map(a=>`
      <div class="asset">
        <div><div class="asset-name">${escapeHtml(a.name)}</div><div class="asset-sub">${escapeHtml(a.symbol)} ${a.address ? short(a.address,6) : ""}</div></div>
        <div class="asset-balance">${fmt(a.balance, a.symbol==="TON"?3:4)}</div>
        <div class="asset-value">${a.symbol}</div>
      </div>`).join("");
  }catch(e){
    console.error(e);
    $("positionsList").innerHTML = `<div class="asset"><div><div class="asset-name">Не удалось загрузить портфель</div><div class="asset-sub">Проверь доступность TON API и обнови страницу.</div></div></div>`;
    $("tonBalance").textContent = "—"; $("saBalance").textContent = "—";
  }
}

function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}

const PHASES = {
  fear:    {name:"СТРАХ", min:0,      max:10000,  color:"#ef555f"},
  courage: {name:"ОТВАГА", min:10000, max:30000,  color:"#4f93ff"},
  greed:   {name:"ЖАДНОСТЬ", min:30000, max:100000, color:"#63d36f"},
  madness: {name:"БЕЗУМИЕ", min:100000, max:300000, color:"#a05cff"}
};
let marketTimer = null;

const money = (n) => {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1000000) return "$" + (n/1000000).toFixed(2) + "M";
  if (n >= 1000) return "$" + (n/1000).toFixed(n >= 10000 ? 0 : 1) + "K";
  if (n >= 1) return "$" + n.toFixed(2);
  if (n > 0) return "$" + n.toPrecision(4);
  return "$0";
};

function getPhase(mcap){
  if (!isFinite(mcap) || mcap <= 10000) return "fear";
  if (mcap <= 30000) return "courage";
  if (mcap <= 100000) return "greed";
  return "madness";
}

function phasePosition(mcap){
  // Log scale maps the full visual track to the four psychological zones.
  const lo = Math.log10(1000), hi = Math.log10(300000);
  const x = (Math.log10(Math.max(1000, Math.min(300000, mcap))) - lo) / (hi-lo);
  return Math.max(0, Math.min(100, x*100));
}

async function getSAPool(){
  const r = await fetch(`${CONFIG.gecko}/networks/ton/tokens/${CONFIG.saJetton}/pools?page=1`, {
    headers: {"Accept":"application/json;version=20230203"}
  });
  if(!r.ok) throw new Error("SA pools unavailable");
  const j = await r.json();
  return j.data?.[0] || null;
}

async function getTokenMarket(){
  // GeckoTerminal returns the top pools ranked by liquidity + activity.
  const tokenR = await fetch(`${CONFIG.gecko}/networks/ton/tokens/${CONFIG.saJetton}`, {
    headers: {"Accept":"application/json;version=20230203"}
  });
  if(!tokenR.ok) throw new Error("SA token unavailable");
  const tokenJ = await tokenR.json();
  const attrs = tokenJ.data?.attributes || {};
  let pool = null;
  try { pool = await getSAPool(); } catch {}
  const p = pool?.attributes || {};
  return {
    price: Number(attrs.price_usd || p.base_token_price_usd || 0),
    mcap: Number(attrs.market_cap_usd || attrs.fdv_usd || p.market_cap_usd || p.fdv_usd || 0),
    liquidity: Number(p.reserve_in_usd || 0),
    volume: Number(p.volume_usd?.h24 || 0),
    change: Number(p.price_change_percentage?.h24 || attrs.price_change_percentage?.h24 || 0),
    poolId: pool?.id?.split("_").pop()
  };
}

async function getHistory(poolId){
  if(!poolId) return [];
  const r = await fetch(`${CONFIG.gecko}/networks/ton/pools/${poolId}/ohlcv/hour?aggregate=1&limit=168`, {
    headers: {"Accept":"application/json;version=20230203"}
  });
  if(!r.ok) return [];
  const j = await r.json();
  return j.data?.attributes?.ohlcv_list || [];
}

function drawSentimentChart(rows, currentMcap){
  const labels = rows.map(x => new Date(x[0]*1000).toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit"}));
  // Convert historical prices to relative market-cap-like line only when a market-cap history exists.
  // Without historical supply/cap data, use price history and label the chart as price movement.
  const values = rows.map(x => Number(x[4]));
  if(window.chart) window.chart.destroy();

  window.chart = new Chart($("saChart"),{
    type:"line",
    data:{labels,datasets:[{
      data:values,borderColor:"#44c8bd",backgroundColor:"rgba(68,200,189,.08)",
      fill:true,borderWidth:2,pointRadius:0,tension:.22
    }]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{mode:"index",intersect:false}},
      scales:{
        x:{grid:{color:"#1b1b1b"},ticks:{color:"#555",maxTicksLimit:7,font:{size:9}}},
        y:{grid:{color:"#1b1b1b"},ticks:{color:"#555",font:{size:9},callback:v=>"$"+Number(v).toPrecision(3)}}
      }
    }
  });
}

function updateSentimentUI(m){
  const phase = getPhase(m.mcap);
  const phaseData = PHASES[phase];
  $("marketCapText").textContent = `Market Cap: ${money(m.mcap)}`;
  $("saPrice").textContent = money(m.price);
  $("saChange").textContent = `${m.change >= 0 ? "+" : ""}${m.change.toFixed(2)}% (24h)`;
  $("saChange").className = m.change >= 0 ? "positive" : "negative";
  $("statPrice").textContent = money(m.price);
  $("statMcap").textContent = money(m.mcap);
  $("statLiquidity").textContent = money(m.liquidity);
  $("statVolume").textContent = money(m.volume);
  $("currentPhase").textContent = phaseData.name;
  $("currentPhase").style.color = phaseData.color;

  const pos = phasePosition(m.mcap);
  $("phaseMarker").style.left = `${pos}%`;
  $("phaseFill").style.width = `${pos}%`;
  $("marketUpdated").textContent = new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit",second:"2-digit"}) + " UTC";
  document.querySelector(".market-card").dataset.phase = phase;

  // Keep the requested $30K "Отвага" boundary explicit.
  $("axisCourage").textContent = "Отвага • $30K";
  $("axisFear").textContent = "Страх • $10K";
  $("axisGreed").textContent = "Жадность • $100K";
  $("axisMadness").textContent = "Безумие • $300K";
}

async function loadSAChart(){
  try{
    const m = await getTokenMarket();
    updateSentimentUI(m);
    const rows = await getHistory(m.poolId);
    if(rows.length) drawSentimentChart(rows,m.mcap);
    $("chartStatus")?.remove();
  }catch(e){
    console.warn(e);
    // The requested initial state is visually Fear until real market data is available.
    $("currentPhase").textContent = "СТРАХ";
    $("currentPhase").style.color = PHASES.fear.color;
    $("marketCapText").textContent = "Market Cap: —";
    $("saPrice").textContent = "$—";
    $("saChange").textContent = "live data unavailable";
  }
  clearTimeout(marketTimer);
  marketTimer = setTimeout(loadSAChart, 30000);
}

function setIdentityUI(){
  const connected = !!connectedAddress;
  $("identityStatus").textContent = connected ? "WALLET CONNECTED" : "WALLET NOT CONNECTED";
  $("identityStatus").style.color = connected ? "#7fd68a" : "#555";
  $("nicknameInput").disabled = !connected || !SUPABASE_READY;
  $("saveNickname").disabled = !connected || !SUPABASE_READY;
  $("messageInput").disabled = !connected || !SUPABASE_READY;
  $("postMessage").disabled = !connected || !SUPABASE_READY;
  $("profileAddress").textContent = connected ? short(connectedAddress,10) : "Кошелёк не подключён";
}

async function initProfile(){
  if(!SUPABASE_READY || !connectedAddress) return;
  try{
    if(!sessionUser){
      const {data,error} = await sb.auth.getSession();
      if(error) throw error;
      sessionUser = data.session?.user || null;
      if(!sessionUser){
        const {data:d,error:e}=await sb.auth.signInAnonymously();
        if(e) throw e;
        sessionUser=d.user;
      }
    }
    const {data,error}=await sb.from("profiles").select("*").eq("wallet_address",connectedAddress).maybeSingle();
    if(error) throw error;
    if(data){
      $("profileName").textContent=data.nickname || short(connectedAddress,8);
      $("nicknameInput").value=data.nickname || "";
      $("profileAvatar").textContent=(data.nickname || "SA").slice(0,2).toUpperCase();
    }else{
      const nickname="Citizen_"+connectedAddress.slice(-6);
      const {data:created,error:e}=await sb.from("profiles").insert({
        user_id:sessionUser.id,wallet_address:connectedAddress,nickname
      }).select().single();
      if(e) throw e;
      $("profileName").textContent=created.nickname;
      $("nicknameInput").value=created.nickname;
      $("profileAvatar").textContent=created.nickname.slice(0,2).toUpperCase();
    }
    await loadWall();
    subscribeWall();
  }catch(e){console.warn("Profile init:",e)}
}

function initWallet(){
  tonUI=new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: location.origin + location.pathname.replace(/\/[^/]*$/,"/") + "tonconnect-manifest.json",
    buttonRootId:"ton-connect"
  });
  tonUI.uiOptions={language:"ru",uiPreferences:{theme:TON_CONNECT_UI.THEME.DARK}};
  tonUI.onStatusChange(async wallet=>{
    connectedAddress = wallet?.account?.address || null;
    if(connectedAddress){
      // TON Connect exposes raw account addresses; the portfolio/UI accepts user-friendly forms.
      try{
        if(window.TON_CONNECT_UI.toUserFriendlyAddress)
          connectedAddress=window.TON_CONNECT_UI.toUserFriendlyAddress(connectedAddress,true);
      }catch{}
    }
    setIdentityUI();
    if(connectedAddress) await initProfile();
  });
}

async function donate(){
  const amount=Number($("customAmount").value || selectedAmount);
  if(!amount || amount<=0){$("donateStatus").textContent="Укажи сумму больше 0.";return;}
  try{
    if(!tonUI.wallet){
      $("donateStatus").textContent="Открываю выбор кошелька…";
      await tonUI.openModal();
      if(!tonUI.wallet) return;
    }
    $("donateStatus").textContent="Подтверди транзакцию в кошельке…";
    const result = await tonUI.sendTransaction({
      validUntil:Math.floor(Date.now()/1000)+300,
      network:"-239",
      messages:[{address:CONFIG.donateWallet,amount:String(Math.round(amount*1e9))}]
    });
    $("donateStatus").textContent="Транзакция отправлена. Спасибо.";
    if(SUPABASE_READY && sessionUser && connectedAddress){
      await sb.from("donations").insert({
        user_id:sessionUser.id,wallet_address:connectedAddress,
        amount_ton:amount,tx_boc:result?.boc || null
      });
      await loadWall();
    }
  }catch(e){
    console.error(e);
    $("donateStatus").textContent="Транзакция отменена или не выполнена.";
  }
}

let wallChannel=null;
async function getMyProfile(){
  if(!sb || !connectedAddress) return null;
  const {data}=await sb.from("profiles").select("*").eq("wallet_address",connectedAddress).maybeSingle();
  return data;
}
async function loadWall(){
  if(!SUPABASE_READY){$("wallFeed").innerHTML='<div class="wall-empty">Добавь Supabase URL и anon key в <b>supabase-config.js</b>, чтобы включить общую стену.</div>';return;}
  try{
    const {data:posts,error}=await sb.from("wall_posts").select("id,type,content,amount_ton,wallet_address,created_at,profiles(nickname)").order("created_at",{ascending:false}).limit(100);
    if(error) throw error;
    const {data:donations}=await sb.from("donations").select("id,amount_ton,wallet_address,created_at,profiles(nickname)").order("created_at",{ascending:false}).limit(100);
    if(error) throw error;
    const items=[];
    (posts||[]).forEach(p=>items.push({kind:"message",...p}));
    (donations||[]).forEach(d=>items.push({kind:"donation",...d}));
    items.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    $("wallFeed").innerHTML=items.length?items.slice(0,100).map(renderWallItem).join(""):'<div class="wall-empty">Пока здесь тихо. Стань первым.</div>';
  }catch(e){
    console.warn("Wall:",e);
    $("wallFeed").innerHTML='<div class="wall-empty">Не удалось загрузить стену. Проверь Supabase и RLS.</div>';
  }
}
function renderWallItem(x){
  const nick=escapeHtml(x.profiles?.nickname || short(x.wallet_address,6));
  const time=new Date(x.created_at).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
  if(x.kind==="donation") return `<article class="wall-item donation-item"><div class="donation-badge">DONATION</div><div class="wall-item-head"><div class="wall-user">${nick}<span>${short(x.wallet_address,5)}</span></div><div class="wall-time">${time}</div></div><div class="donation-amount">+ ${fmt(x.amount_ton,2)} TON</div></article>`;
  return `<article class="wall-item"><div class="wall-item-head"><div class="wall-user">${nick}<span>${short(x.wallet_address,5)}</span></div><div class="wall-time">${time}</div></div><div class="wall-text">${escapeHtml(x.content)}</div></article>`;
}
function subscribeWall(){
  if(!SUPABASE_READY || wallChannel) return;
  wallChannel=sb.channel("sa-wall-live").on("postgres_changes",{event:"*",schema:"public",table:"wall_posts"},()=>loadWall()).on("postgres_changes",{event:"*",schema:"public",table:"donations"},()=>loadWall()).subscribe();
}
async function saveNickname(){
  if(!SUPABASE_READY || !sessionUser || !connectedAddress) return;
  const nickname=$("nicknameInput").value.trim().replace(/\s+/g," ");
  if(nickname.length<2) return;
  const {error}=await sb.from("profiles").upsert({
    user_id:sessionUser.id,wallet_address:connectedAddress,nickname
  },{onConflict:"wallet_address"});
  if(error){console.warn(error);return}
  $("profileName").textContent=nickname;
  $("profileAvatar").textContent=nickname.slice(0,2).toUpperCase();
}
async function postMessage(){
  if(!SUPABASE_READY || !sessionUser || !connectedAddress) return;
  const content=$("messageInput").value.trim();
  if(!content) return;
  const {error}=await sb.from("wall_posts").insert({
    user_id:sessionUser.id,wallet_address:connectedAddress,type:"message",content
  });
  if(error){console.warn(error);return}
  $("messageInput").value="";
  await loadWall();
}

function initUI(){
  $("explorerLink").href=`https://tonviewer.com/${CONFIG.trackedWallet}`;
  document.querySelectorAll("[data-amount]").forEach(b=>b.onclick=()=>{
    selectedAmount=Number(b.dataset.amount); $("customAmount").value="";
    document.querySelectorAll("[data-amount]").forEach(x=>x.classList.remove("selected")); b.classList.add("selected");
  });
  $("donateButton").onclick=donate;
  $("saveNickname").onclick=saveNickname;
  $("postMessage").onclick=postMessage;
  $("refreshWall").onclick=loadWall;
  setIdentityUI();
  $("refresh").onclick=()=>{loadPortfolio();loadSAChart()};
}
window.addEventListener("DOMContentLoaded",()=>{
  initUI(); initWallet(); loadPortfolio(); loadSAChart();
});
