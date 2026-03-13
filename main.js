/**
 * KB PARK ユーザー画面ロジック (Ver 3.2: QRコード表示修正版)
 * - QRコード生成ロジックを強化
 * - 3ファイル分割バックエンド(Ver 3.1)対応
 */

// ★ GASのウェブアプリURL
// ※デプロイして発行された最新のURLをここに貼り付けてください
console.log('[KB] main.js loaded: 2026-02-22 waitlist=v1 loader=v2');

const API_URL = 'https://script.google.com/macros/s/AKfycbzrsSooV2Trzhz55FOs5jkYVg6scPnTnVenqboeNurvdEQ9LS3OcWNoUqruGFgGIMUo/exec';

// 状態管理
const STATE = {
    user: null,         // ログイン中のユーザー情報
    slots: [],          // 取得した予約枠データ
    settings: {},       // システム設定
    currentMonth: new Date(), // 現在表示中の月
    selectedDate: null,
    selectedSlot: null,
    selectedSlotWaitlist: false
};

// ローディング制御
const LOADER_STATE = {
    count: 0,
    usePanda: false
};

// 初回表示で「裏方が一瞬見える」問題を抑止
(function(){
    try{
        document.documentElement.classList.add('kb-booting');
        const st = document.createElement('style');
        st.id = 'kbBootStyle';
        st.textContent = `
            .kb-booting body > :not(#loadingOverlay):not(#loaderOverlay):not(#loader) { visibility: hidden !important; }
            .kb-booting #loadingOverlay, .kb-booting #loaderOverlay, .kb-booting #loader { display: flex !important; }
            .kb-booting #loadingOverlay.hidden, .kb-booting #loaderOverlay.hidden, .kb-booting #loader.hidden { display: flex !important; }
        `;
        document.head.appendChild(st);
    }catch(_){}
})();

function getDeviceId_(){
    try{
        const k = 'kbperk_device_id';
        let v = localStorage.getItem(k);
        if(!v){
            v = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('did_' + Date.now() + '_' + Math.floor(Math.random()*1e9));
            localStorage.setItem(k, v);
        }
        return v;
    }catch(_){
        return 'did_' + Date.now();
    }
}

// ==========================================
// 1. 初期化 & API通信
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    try {
    showLoader(true);
    loadUserSession();
    
    const prevBtn = document.getElementById('prevMonthBtn');
    const nextBtn = document.getElementById('nextMonthBtn');
    if(prevBtn) prevBtn.addEventListener('click', () => changeMonth(-1));
    if(nextBtn) nextBtn.addEventListener('click', () => changeMonth(1));

    const qrBtn = document.querySelector('button[onclick="openModal(\'qrModal\')"]');
    if(qrBtn) {
        qrBtn.onclick = (e) => {
            e.preventDefault(); 
            showQrModal();
        };
    }

    const headCountSelect = document.querySelector('#reserveForm select[name="head_count"]');
    if (headCountSelect) {
        headCountSelect.addEventListener('change', updateReserveAmountDisplay_);
    }

    const tasks = [initAppData()];
    if (STATE.user) {
        tasks.push(loadMyReservations());
    }
    await Promise.all(tasks);

    try{
        const raw = sessionStorage.getItem('kb_flash_after_reload');
        if(raw){
            sessionStorage.removeItem('kb_flash_after_reload');
            const o = JSON.parse(raw);
            if(o && o.text){
                showMessageModal(o.type || 'info', String(o.text));
            }
        }
    }catch(_){}

    } finally {
        showLoader(false);
    }
});

function changeMonth(offset) {
    const d = STATE.currentMonth;
    d.setDate(1); 
    d.setMonth(d.getMonth() + offset);
    STATE.currentMonth = new Date(d);
    
    renderCalendar(STATE.slots);
}

async function initAppData() {
    try {
        const res = await callApi('get_slots', {});
        if (res.slots) {
            STATE.slots = res.slots;
            STATE.settings = res.settings;
            renderCalendar(STATE.slots);
        }
    } catch (e) {
        console.error(e);
    } finally {
        try{ document.documentElement.classList.remove('kb-booting'); const st=document.getElementById('kbBootStyle'); if(st) st.remove(); }catch(_){ }
    }
}

async function callApi(action, params = {}) {
    showLoader(true);
    try{
    const device_id = getDeviceId_();
    const payload = { action, ...params };

    if (['get_slots','reserve','cancel','my_reservations'].includes(action)) {
        payload.device_id = device_id;
    }

    const body = JSON.stringify(payload);
    const response = await fetch(API_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain' },
        body: body
    });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'API Error');
    return json.data;
    } finally {
        showLoader(false);
    }
}

async function loadMyReservations() {
    if (!STATE.user) return;
    try {
        const res = await callApi('my_reservations', { member_id: STATE.user.member_id });
        renderMyReservations(res.reservations || []);
    } catch (e) {
        console.error(e);
        renderMyReservations([]);
    }
}

function renderMyReservations(items) {
    const wrap = document.getElementById('myReservations');
    const empty = document.getElementById('myReservationsEmpty');
    if (!wrap) return;
    wrap.innerHTML = '';
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const futureItems = items.filter(it => {
        if (!it.date) return true;
        const d = new Date(it.date);
        d.setHours(0, 0, 0, 0);
        return d >= today;
    });

    if (!futureItems || futureItems.length === 0) {
        if (empty) empty.classList.remove('hidden');
        return;
    }
    if (empty) empty.classList.add('hidden');

    futureItems.forEach(it => {
        const div = document.createElement('div');
        div.className = 'border-2 border-gray-200 rounded-2xl p-4 bg-white';
        const cancelBtn = it.cancelable
            ? `<button class="mt-3 w-full bg-red-600 text-white font-bold py-3 rounded-xl shadow hover:brightness-110 transition" data-resid="${it.reservation_id}" data-wait="${it.is_waitlist ? 1 : 0}">キャンセルする</button>`
            : `<div class="mt-3 text-sm text-gray-500">※キャンセル締切（前日）を過ぎています。当日キャンセルは全額負担となります。</div>`;
        div.innerHTML = `
            <div class="flex items-baseline justify-between">
                <div class="text-lg font-black text-pop-green">${it.date} ${it.time}</div>
                ${it.is_waitlist ? `<div class="mt-1 inline-block text-xs font-black bg-yellow-200 text-yellow-900 px-2 py-1 rounded-lg">キャンセル待ち</div>` : ``}
                <div class="text-lg font-black">${it.head_count}名</div>
            </div>
            <div class="mt-1 text-sm text-gray-600">料金: <span class="font-bold text-blue-600">${Number(it.amount||0).toLocaleString('ja-JP')}円（税込）</span></div>
            ${cancelBtn}
        `;
        wrap.appendChild(div);
    });

    wrap.querySelectorAll('button[data-resid]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const resid = btn.getAttribute('data-resid');
            if (!resid) return;
            const ok = await confirmModal((btn.getAttribute('data-wait')==='1' ? 'このキャンセル待ちをキャンセルします。よろしいですか？' : 'この予約をキャンセルします。よろしいですか？'),'キャンセルする','やめる');
            if (!ok) return;
            try {
                showLoader(true);
                await callApi('cancel', { member_id: STATE.user.member_id, reservation_id: resid });
                await showAlert('キャンセル受付', 'キャンセルが完了しました。\nOKを押すと画面を更新します。');
                showLoader(true);
                window.location.reload();
            } catch (e) {
                showMessageModal('error', e.message || String(e));
            } finally {
                showLoader(false);
            }
        });
    });
}

// ==========================================
// 2A. 時刻系ユーティリティ
// ==========================================
function nowTokyo_(){
    return new Date();
}
function parseSlotDateTime_(dateStr, timeStr){
    const m = String(dateStr||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const t = String(timeStr||'').match(/^(\d{2}):(\d{2})/);
    if(!m || !t) return null;
    const y = Number(m[1]), mo = Number(m[2])-1, d = Number(m[3]);
    const hh = Number(t[1]), mm = Number(t[2]);
    return new Date(y, mo, d, hh, mm, 0, 0);
}
function isPastDay_(dateStr){
    const now = nowTokyo_();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dt = parseSlotDateTime_(dateStr, '00:00');
    if(!dt) return false;
    const day = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    return day < today;
}
function isPastSlotByCutoff_(dateStr, timeStr){
    const now = nowTokyo_();
    const cutoff = new Date(now.getTime() - 60*60*1000);
    const st = parseSlotDateTime_(dateStr, timeStr);
    if(!st) return false;
    return st < cutoff;
}

// ==========================================
// 2. カレンダー & 予約枠描画
// ==========================================

function renderCalendar(slots) {
    const grid = document.getElementById('calendarDays');
    const label = document.getElementById('currentMonthLabel');
    if(!grid) return;
    grid.innerHTML = '';

    const viewDate = STATE.currentMonth;
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth(); 
    
    label.textContent = `${year}年 ${month + 1}月`;

    const firstDay = new Date(year, month, 1);
    const startDow = firstDay.getDay(); 
    const endDay = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < startDow; i++) {
        grid.appendChild(document.createElement('div'));
    }

    for (let d = 1; d <= endDay; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const daySlots = slots.filter(s => s.date === dateStr);
        const isOpen = daySlots.length > 0;
        const isPastDay = isPastDay_(dateStr);

        const isFull = isOpen && daySlots.every(s => s.remaining === 0);

        const totalCap = daySlots.reduce((sum, s) => sum + Number(s.capacity_max || 0), 0);
        const totalRemaining = daySlots.reduce((sum, s) => sum + Number(s.remaining || 0), 0);
        const isFew = isOpen && totalRemaining > 0 && totalCap > 0 && (totalRemaining / totalCap) <= 0.25;
        
        const btn = document.createElement('button');
        
        let bgClass = 'bg-white border-2 border-pop-green text-pop-text shadow-sm';
        if (!isOpen) bgClass = 'bg-gray-100 text-gray-300 cursor-not-allowed border-transparent';
        else if (isFull) bgClass = 'bg-gray-200 text-gray-400 border-transparent';
        else if (isFew) bgClass = 'bg-white border-2 border-pop-yellow text-pop-text shadow-sm';

        if(isPastDay && isOpen){
            bgClass = 'bg-gray-100 text-gray-500 border-transparent';
        }

        if (STATE.selectedDate === dateStr) {
            bgClass = 'bg-pop-pink text-white border-transparent';
        }

        btn.className = `aspect-square rounded-xl flex flex-col items-center justify-center relative transition hover:scale-105 ${bgClass}`;
        btn.innerHTML = `<span class="text-lg font-bold font-english">${d}</span>`;
        
        if (isOpen) {
            if(isPastDay){
                const stamp = document.createElement('span');
                stamp.className = 'kb-stamp-done';
                stamp.innerHTML = '済';
                btn.appendChild(stamp);
                btn.disabled = true;
            }
            const badge = document.createElement('span');
            badge.className = `absolute bottom-1 w-2 h-2 rounded-full ${
                isFull ? 'bg-gray-400' : isFew ? 'bg-pop-yellow' : 'bg-pop-green'
            }`;
            btn.appendChild(badge);
            if(!isPastDay){
                btn.onclick = () => onDateSelect(dateStr, daySlots, btn);
            }

        } else {
            btn.disabled = true;
        }
        grid.appendChild(btn);
    }
}

function onDateSelect(dateStr, daySlots, btnEl) {
    STATE.selectedDate = dateStr;
    renderCalendar(STATE.slots);
    renderTimeSlots(daySlots);
}

function renderTimeSlots(daySlots) {
    const container = document.getElementById('timeSlotsContainer');
    const area = document.getElementById('timeSelectArea');
    container.innerHTML = '';
    area.classList.remove('hidden');

    daySlots.sort((a, b) => a.start_time.localeCompare(b.start_time));

    daySlots.forEach(slot => {
        const btn = document.createElement('button');
        const isFull = slot.remaining === 0;
        const isPast = isPastDay_(slot.date) || isPastSlotByCutoff_(slot.date, slot.start_time);

        btn.className = `p-3 rounded-xl border-2 font-bold flex justify-between items-center transition ${
            (isPast)
            ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
            : (isFull
                ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-white border-pop-cyan text-pop-text hover:bg-pop-cyan hover:text-white'
            )
        }`;
        btn.disabled = isPast || isFull;

        const rightBadge = isPast
            ? '済'
            : (isFull ? '満員でっせ！' : ('残'+slot.remaining));

        const rightClass = isPast
            ? 'bg-red-100 text-red-700 px-2 py-1 rounded-full border border-red-300'
            : (isFull 
                ? 'bg-red-500 text-white px-2 py-1 rounded-full border border-red-600 text-[10px] md:text-xs' 
                : 'bg-pop-yellow text-black px-2 py-1 rounded-full');

        btn.innerHTML = `
            <span class="font-english text-lg">${slot.start_time}</span>
            <span class="text-xs ${rightClass}">
                ${rightBadge}
            </span>
        `;

        if (!isPast && !isFull) {
            btn.onclick = () => onSlotSelect(slot, { waitlist: false });
        }
        container.appendChild(btn);
    });

    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function onSlotSelect(slot, opts = {}) {
    if (!STATE.user) {
        showMessageModal('warn','予約へ進むにはログインまたは新規登録を行ってください。','ログインが必要です');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }
    STATE.selectedSlot = slot;
    STATE.selectedSlotWaitlist = !!(opts && opts.waitlist);
    document.getElementById('resDate').textContent = slot.date;
    document.getElementById('resTime').textContent = slot.start_time;
    document.getElementById('resSlotId').value = slot.slot_id;
    document.getElementById('resOwnerName').textContent = STATE.user.name;

    const selectEl = document.querySelector('#reserveForm select[name="head_count"]');
    if (selectEl) {
        selectEl.innerHTML = '';
        const maxHead = Math.max(1, slot.remaining || 1);
        for (let i = 1; i <= maxHead; i++) {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = i + '名';
            selectEl.appendChild(opt);
        }
        selectEl.value = "1";
    }

    updateReserveAmountDisplay_();
    openModal('reserveModal');
}

let TERMS_AGREED_THIS_TIME = false;

// ★ 変更箇所: 人数変更時にキャンペーン値引きをUIに表示
function updateReserveAmountDisplay_(){
    const el = document.getElementById('resAmount');
    if(!el) return;
    const sel = document.querySelector('#reserveForm select[name="head_count"]');
    const head = sel ? Number(sel.value||0) : 0;

    const s = STATE.selectedSlot || {};
    const pricingEnabled = !!(STATE.settings && (STATE.settings.pricingEnabled === true || String(STATE.settings.pricingEnabled||'').toLowerCase()==='true'));
    const unit = Number(s.unitPrice || 0) || 0;
    const amount = head * unit;

    if(pricingEnabled){
        const label = (s.dayType === 'weekend_holiday') ? '土日祝（週末扱い）' : '平日';
        let campHtml = '';
        // キャンペーン中であればピンク色のバッジでアピール
        if (s.isCampaign && s.campaignDiscount > 0) {
            campHtml = `<div class="text-xs text-pop-pink font-bold mt-1">🎁 キャンペーン適用中！(1人あたり -${s.campaignDiscount}円)</div>`;
        }
        el.innerHTML = `利用料金（${label}）: <span class="font-black text-blue-600">${amount.toLocaleString('ja-JP')}円（税込）</span>${campHtml}`;
        el.classList.remove('hidden');
    }else{
        el.classList.add('hidden');
        el.innerHTML = '';
    }
}

function openTermsBeforeReserve_(){
    TERMS_AGREED_THIS_TIME = false;
    const modal = document.getElementById('termsReserveModal');
    if(!modal) return false;

    const src = document.getElementById('termsBox');
    const body = document.getElementById('termsReserveBody');
    if(src && body){
        body.innerHTML = src.innerHTML;
    }

    const sc = document.getElementById('termsReserveScroll');
    const chk = document.getElementById('termsReserveCheck');
    const lbl = document.getElementById('termsReserveLabel');
    const btn = document.getElementById('termsReserveAgreeBtn');
    if(sc && chk && btn){
        chk.checked = false;
        chk.disabled = true;
        chk.style.pointerEvents = 'none';
        if(lbl){ lbl.classList.remove('text-gray-900'); lbl.classList.add('text-gray-400'); lbl.style.pointerEvents = 'none'; }
        btn.disabled = true;

        sc.scrollTop = 0;
        let hasUserScrolled = false;

        const updateGate = () => {
            const atBottom = (sc.scrollTop + sc.clientHeight) >= (sc.scrollHeight - 8);
            if(hasUserScrolled && atBottom){
                chk.disabled = false;
                chk.style.pointerEvents = 'auto';
                if(lbl){
                    lbl.classList.remove('text-gray-400'); lbl.classList.add('text-gray-900');
                    lbl.style.pointerEvents = 'auto';
                }
            } else {
                chk.checked = false;
                chk.disabled = true;
                chk.style.pointerEvents = 'none';
                if(lbl){
                    lbl.classList.remove('text-gray-900'); lbl.classList.add('text-gray-400');
                    lbl.style.pointerEvents = 'none';
                }
                btn.disabled = true;
            }
        };

        sc.onscroll = () => {
            hasUserScrolled = true;
            updateGate();
        };

        updateGate();

        chk.onchange = () => {
            btn.disabled = (!chk.checked || chk.disabled);
        };
        btn.onclick = () => {
            TERMS_AGREED_THIS_TIME = true;
            closeModal('termsReserveModal');
            const f = document.getElementById('reserveForm');
            if(f){
                f.requestSubmit();
            }
        };
    }

    openModal('termsReserveModal');
    return true;
}

// ==========================================
// 3. 認証 (ログイン/登録/ID忘れ救済)
// ==========================================

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button');
    
    const params = {
        member_id: form.member_id.value.trim(),
        phone_last4: form.phone_last4.value.trim()
    };

    btn.disabled = true;
    btn.textContent = '確認中...';

    try {
        const user = await callApi('login', params);
        saveUserSession(user);
        closeModal('loginModal');
        showMessageModal('info', `おかえりなさい、${user.name} さん！`, 'ログイン成功');
        form.reset();
    } catch (err) {
        showMessageModal('error', err.message, 'ログイン失敗');
    } finally {
        btn.disabled = false;
        btn.textContent = 'ログインして予約へ';
    }
});

const forgotIdForm = document.getElementById('forgotIdForm');
if(forgotIdForm) {
    forgotIdForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const btn = form.querySelector('button');
        
        const params = {
            name: form.name.value.trim(),
            email: form.email.value.trim()
        };

        btn.disabled = true;
        btn.textContent = '照会中...';

        try {
            const res = await callApi('forgot_id', params);
            
            document.getElementById('forgotIdResultText').textContent = res.member_id;
            closeModal('forgotIdModal');
            openModal('forgotIdResultModal');
            
            form.reset();
        } catch (err) {
            showMessageModal('error', err.message, '照会失敗');
        } finally {
            btn.disabled = false;
            btn.textContent = '照会する';
        }
    });
}

const forgotIdResultLoginBtn = document.getElementById('forgotIdResultLoginBtn');
if (forgotIdResultLoginBtn) {
    forgotIdResultLoginBtn.addEventListener('click', () => {
        const idText = document.getElementById('forgotIdResultText').textContent;
        closeModal('forgotIdResultModal');
        openModal('loginModal');
        
        const loginForm = document.getElementById('loginForm');
        if (loginForm && loginForm.member_id) {
            loginForm.member_id.value = idText;
            if (loginForm.phone_last4) {
                setTimeout(() => loginForm.phone_last4.focus(), 100);
            }
        }
    });
}

document.getElementById('btnZipSearch').addEventListener('click', async () => {
    const zipInput = document.getElementById('regZip');
    const addrInput = document.getElementById('regAddress');
    const zip = zipInput.value.replace(/[^\d]/g, '');

    if (zip.length !== 7) {
        showMessageModal('warn','郵便番号は7桁の数字で入力してください。','入力エラー');
        return;
    }
    addrInput.value = '検索中...';
    try {
        const url = `https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.results) {
            const r = data.results[0];
            addrInput.value = r.address1 + r.address2 + r.address3;
        } else {
            addrInput.value = '';
            showMessageModal('warn','該当する住所が見つかりませんでした。\n手入力をお願いします。','検索結果なし');
            addrInput.removeAttribute('readonly');
            addrInput.focus();
        }
    } catch (e) {
        addrInput.value = '';
        showMessageModal('error','住所検索に失敗しました。','通信エラー');
    }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button');
    const fullAddress = form.address.value + ' ' + form.address_street.value;

    const rawBirth = form.birth_date.value.replace(/[^\d]/g, '');
    if(rawBirth.length !== 8){
        showMessageModal('warn','生年月日は8桁の数字（例: 19790808）で入力してください。','入力エラー');
        return;
    }
    const formattedBirth = `${rawBirth.substring(0,4)}-${rawBirth.substring(4,6)}-${rawBirth.substring(6,8)}`;

    const params = {
        name: form.name.value,
        phone: form.phone.value,
        emergency_phone: form.emergency_phone.value,
        email: form.email.value,
        zip_code: form.zip_code.value,
        address: fullAddress,
        birth_date: formattedBirth
    };
    
    if(!form.address.value || !form.address_street.value) {
        showMessageModal('warn','住所と番地を正しく入力してください。','入力漏れ');
        return;
    }

    const ok = await showConfirm('確認', '本名と連絡先に間違いはありませんか？\n（虚偽の登録は対応できない場合があります）');
    if(!ok) return;

    btn.disabled = true;
    btn.textContent = '登録処理中...';

    try {
        const res = await callApi('register', params);
        const user = { member_id: res.member_id, name: res.name, token: 'new_session' };
        saveUserSession(user);
        closeModal('registerModal');
        showMessageModal('info', `ようこそ！\nあなたの会員IDは【 ${res.member_id} 】です。\n忘れないようにメモしてください。`, '登録完了！');
        showQrModal();
    } catch (err) {
        showMessageModal('error', err.message, '登録エラー');
    } finally {
        btn.disabled = false;
        btn.textContent = '登録する';
    }
});

// ==========================================
// 4. セッション & UI管理 & QR表示
// ==========================================

function saveUserSession(user) {
    STATE.user = user;
    localStorage.setItem('kb_user_v3', JSON.stringify(user));
    try{ loadMyReservations(); }catch(_){}
    updateHeaderUI();
}
function loadUserSession() {
    const json = localStorage.getItem('kb_user_v3');
    if (json) {
        STATE.user = JSON.parse(json);
        updateHeaderUI();
    }
}
function updateHeaderUI() {
    const isLogged = !!STATE.user;
    const headerArea = document.getElementById('headerUserArea');
    const authSection = document.getElementById('authSection');
    const bookSection = document.getElementById('bookingSection');

    if (isLogged) {
        headerArea.classList.remove('hidden');
        document.getElementById('headerUserName').textContent = STATE.user.name + ' 様';
        authSection.classList.add('hidden');
        bookSection.classList.remove('hidden');
        const mySec = document.getElementById('myReservationsSection');
        if(mySec) mySec.classList.remove('hidden');
        
        document.getElementById('dispMemberName').textContent = STATE.user.name + ' 様';
        document.getElementById('dispMemberId').textContent = STATE.user.member_id;
        
        updateQrImage();
        document.getElementById('qrMemberId').textContent = STATE.user.member_id;
    } else {
        headerArea.classList.add('hidden');
        authSection.classList.remove('hidden');
        bookSection.classList.add('hidden');
        const mySec = document.getElementById('myReservationsSection');
        if(mySec) mySec.classList.add('hidden');
    }
}

function showQrModal() {
    if (!STATE.user) return;
    updateQrImage();
    document.getElementById('qrMemberId').textContent = STATE.user.member_id;
    openModal('qrModal');
}

function updateQrImage() {
    if (!STATE.user || !STATE.user.member_id) return;
    const safeId = encodeURIComponent(STATE.user.member_id);
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${safeId}`;
    const imgEl = document.getElementById('qrImage');
    if(imgEl) {
        imgEl.src = qrUrl;
        console.log('QR Code updated:', qrUrl);
    }
}

document.getElementById('headerLogoutBtn').onclick = async () => {
    const ok = await showConfirm('ログアウト', 'ログアウトしますか？');
    if(ok){
        localStorage.removeItem('kb_user_v3');
        STATE.user = null;
        updateHeaderUI();
        window.location.reload();
    }
};

// ==========================================
// 5. 予約実行
// ==========================================

document.getElementById('reserveForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!STATE.user || !STATE.selectedSlot) return;

    if (!TERMS_AGREED_THIS_TIME) {
        openTermsBeforeReserve_();
        return;
    }
    TERMS_AGREED_THIS_TIME = false;

    const form = e.target;
    const btn = form.querySelector('button');

    const head = Number(form.head_count.value);
    const unit = Number((STATE.selectedSlot && STATE.selectedSlot.unitPrice) ? STATE.selectedSlot.unitPrice : 0) || 0;
    const pricingEnabled = !!(STATE.settings && (STATE.settings.pricingEnabled === true || String(STATE.settings.pricingEnabled||'').toLowerCase()==='true'));
    
    // UIで計算した結果をAPIに送る（最終的な保存額はバックエンドで厳密に再計算されます）
    const estAmount = pricingEnabled ? (head * unit) : 0;

    const params = {
        member_id: STATE.user.member_id,
        slot_id: STATE.selectedSlot.slot_id,
        head_count: head,
        amount: estAmount,
        details: { note: 'Web予約' },
        waitlist: !!STATE.selectedSlotWaitlist
    };

    btn.disabled = true;
    btn.textContent = '予約しています...';
    try {
        const reserveRes = await callApi('reserve', params);
        closeModal('reserveModal');

        await showAlert('予約完了', 'ご予約が完了いたしました！\nOKを押すと最新の予約状況に更新します。');

        showLoader(true);
        window.location.reload();
    } catch (e) {
        showMessageModal('error', e.message || String(e));
    } finally {
        btn.disabled = false;
        btn.textContent = '予約へ進む';
    }
});

// ==========================================
// 6. UIユーティリティ
// ==========================================

function showLoader(show){
    const ov = document.getElementById('loadingOverlay') || document.getElementById('loaderOverlay') || document.getElementById('loader');
    if(!ov) return;

    if(show){
        LOADER_STATE.count = (LOADER_STATE.count || 0) + 1;

        if(LOADER_STATE.count === 1){
            LOADER_STATE.usePanda = (Math.random() < 0.5);
        }

        const panda = document.getElementById('loaderImgPanda');
        if(panda){
            panda.classList.toggle('hidden', !LOADER_STATE.usePanda);

            const spinners = ov.querySelectorAll('.animate-spin, .kb-spinner, [data-loader-spinner="1"]');
            spinners.forEach(el => el.classList.toggle('hidden', LOADER_STATE.usePanda));
        }
        ov.classList.remove('hidden');
        ov.classList.add('flex');
    } else {
        LOADER_STATE.count = Math.max(0, (LOADER_STATE.count || 0) - 1);
        if(LOADER_STATE.count > 0){
            return;
        }

        ov.classList.add('hidden');
        ov.classList.remove('flex');

        LOADER_STATE.usePanda = false;

        const panda = document.getElementById('loaderImgPanda');
        if(panda) panda.classList.add('hidden');
        const spinners = ov.querySelectorAll('.animate-spin, .kb-spinner, [data-loader-spinner="1"]');
        spinners.forEach(el => el.classList.remove('hidden'));
    }
}

function showMessage(title, body, type = 'blue') {
    const modal = document.getElementById('messageModal');
    document.getElementById('msgTitle').textContent = title;
    document.getElementById('msgBody').textContent = body;
    
    let colorClass = 'bg-msg-blue';
    let icon = 'ℹ️';
    if(type === 'yellow') { colorClass = 'bg-msg-yellow'; icon = '⚠️'; }
    if(type === 'red') { colorClass = 'bg-msg-red'; icon = '🛑'; }

    document.getElementById('msgIcon').textContent = icon;
    const btn = document.getElementById('msgBtn');
    btn.className = `w-full py-3 rounded-xl font-bold text-white shadow-md transition transform active:scale-95 ${colorClass} hover:brightness-110`;
    
    modal.classList.remove('hidden');
}

function showAlert(title, body) {
    return new Promise(resolve => {
        const modal = document.getElementById('messageModal');
        document.getElementById('msgTitle').textContent = title;
        document.getElementById('msgBody').textContent = body;
        document.getElementById('msgIcon').textContent = 'ℹ️';
        
        const btn = document.getElementById('msgBtn');
        btn.className = `w-full py-3 rounded-xl font-bold text-white shadow-md transition transform active:scale-95 bg-msg-blue hover:brightness-110`;
        
        const cleanup = () => {
            modal.classList.add('hidden');
            btn.onclick = closeMessageModal;
            resolve();
        };
        
        btn.onclick = cleanup;
        modal.classList.remove('hidden');
    });
}

function showConfirm(title, body) {
    return new Promise(resolve => {
        const modal = document.getElementById('confirmModal');
        document.getElementById('cfmTitle').textContent = title;
        document.getElementById('cfmBody').textContent = body;
        
        const yesBtn = document.getElementById('cfmYesBtn');
        const noBtns = modal.querySelectorAll('button:not(#cfmYesBtn)');

        const cleanup = () => {
            modal.classList.add('hidden');
            yesBtn.onclick = null;
            noBtns.forEach(b => b.onclick = null);
        };

        yesBtn.onclick = () => { cleanup(); resolve(true); };
        noBtns.forEach(b => {
            b.onclick = () => { cleanup(); resolve(false); };
        });

        modal.classList.remove('hidden');
    });
}

function showMessageModal(type, message, title){
    const t = title || (type==='error' ? '失敗' : (type==='warn' ? '注意' : 'お知らせ'));
    const color = (type==='error') ? 'red' : (type==='warn' ? 'yellow' : 'blue');
    showMessage(t, String(message||''), color);
}
function confirmModal(message, yesText, noText){
    return showConfirm('確認', String(message||''));
}