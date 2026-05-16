/**
 * payment.js — IRRA TOPUP
 * Bakong KHQR Payment via CamRapidPay — packages loaded from server (/api/packages)
 * Depends on: QRCode.js, ml-check-id.js (exposes window.isVerified)
 */

// =============================================================================
// CONFIG
// =============================================================================

const PAYMENT_API      = "https://backendtopup.onrender.com"; // relative path to backend
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_MS      = 10 * 60 * 1000; // 10 minutes

// =============================================================================
// STATE
// =============================================================================

let packages        = [];   // loaded from /api/packages on DOMContentLoaded
let selectedPackage = null;
let pollInterval    = null;
let pollStartTime   = null;

// =============================================================================
// 1. LOAD + RENDER PACKAGES FROM SERVER
// =============================================================================

async function loadPackages() {
    const container = document.getElementById('packageContainer');
    if (!container) return;

    // Show skeleton while loading
    container.innerHTML = `
        <div class="col-span-full text-center text-white/40 text-sm py-8">
            <i class="fas fa-circle-notch fa-spin mr-2"></i> Loading packages...
        </div>`;

    try {
        const res  = await fetch(`${PAYMENT_API}/api/packages`);
        const data = await res.json();

        if (data.status !== "SUCCESS" || !data.packages?.length) {
            container.innerHTML = `<p class="col-span-full text-center text-red-400 text-sm py-8">
                Failed to load packages. Please refresh.</p>`;
            return;
        }

        packages = data.packages;
        renderPackages();

    } catch (e) {
        console.error("[loadPackages]", e);
        container.innerHTML = `<p class="col-span-full text-center text-red-400 text-sm py-8">
            SERVER ERROR</p>`;
    }
}

function renderPackages() {
    const container = document.getElementById('packageContainer');
    if (!container) return;

    container.innerHTML = packages.map(pkg => `
        <div onclick="selectPackage(${pkg.id})"
             id="pkg-${pkg.id}"
             class="bg-card border-2 border-slate-700 p-3 rounded-xl cursor-pointer package-card
                    flex items-center space-x-3 transition-all hover:border-blue-400 relative">

            <!-- ✅ CHECK ICON -->
            <div class="check-icon absolute top-1 right-1 w-5 h-5 bg-blue-600 text-white text-xs 
                        flex items-center justify-center rounded-full hidden shadow-md">
                ✓
            </div>

            <!-- PRODUCT IMAGE -->
            <div class="relative">
                <img src="${pkg.image}" 
                     class="w-10 h-10 rounded-lg object-cover shadow-lg"
                     alt="${pkg.name}" loading="lazy">
            </div>

            <div class="flex-1">
                <p class="text-blue-custom font-bold text-base leading-tight">
                    $${pkg.price.toFixed(2)}
                </p>
                <p class="text-[9px] text-white leading-tight uppercase font-medium mt-0.5">
                    ${pkg.name}
                </p>
            </div>
        </div>
    `).join('');
}

// =============================================================================
// 2. SELECT PACKAGE
// =============================================================================

function selectPackage(id) {
    selectedPackage = packages.find(p => p.id === id) || null;
    if (!selectedPackage) return;

    document.getElementById('displayTotal').innerText =
        `$${selectedPackage.price.toFixed(2)}`;

    document.getElementById('displayProduct').innerText =
        selectedPackage.name;

    // Reset all cards
    document.querySelectorAll('.package-card').forEach(el => {
        el.classList.remove('selected');
        const check = el.querySelector('.check-icon');
        if (check) check.classList.add('hidden');
    });

    // Highlight selected card
    const card = document.getElementById(`pkg-${id}`);
    if (card) {
        card.classList.add('selected');
        const check = card.querySelector('.check-icon');
        if (check) check.classList.remove('hidden');
    }

    updateButtonState();
}

// =============================================================================
// 3. PAY BUTTON STATE
// =============================================================================
function updateButtonState() {
    const payBtn     = document.getElementById('payBtn');
    const payBtnText = document.getElementById('payBtnText');
    if (!payBtn) return;

    const verified = (typeof isVerified !== 'undefined' && isVerified === true);

    if (selectedPackage && verified) {
        payBtn.disabled = false;
        // This resets the text and removes the loading spinner icon
        payBtn.innerHTML = '<span id="payBtnText">Pay Now</span>'; 
    } else {
        payBtn.disabled = true;
        payBtn.innerHTML = '<span id="payBtnText">PAY NOW</span>';
    }
}
// =============================================================================
// 4. HANDLE PAYMENT
// =============================================================================
async function handlePayment() {
    if (!selectedPackage) return;

    const gid = (document.getElementById('gameId')   || {}).value?.trim() || '';
    const sid = (document.getElementById('serverId') || {}).value?.trim() || '';
    
    // --- [FIXED] GET NICKNAME FROM THE UI ---
    const nick = (document.getElementById('playerNickname') || {}).innerText || 'N/A';

    if (!gid) { showToast("Please enter your Game ID.", "error"); return; }

    const btn = document.getElementById('payBtn');
    if (btn) {
        // Keeping your Pro Style loading state
        btn.disabled = true;
        btn.innerHTML = `
            <span class="relative z-10 flex items-center gap-2">
                <i class="fas fa-circle-notch fa-spin"></i>
                <span>Processing...</span>
            </span>
            <span class="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-enabled:animate-shimmer"></span>
        `;
    }

    try {
        const response = await fetch(`${PAYMENT_API}/create-payment`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                packageId: selectedPackage.id,
                gameId:    gid,
                serverId:  sid,
                nickname:  nick // --- [FIXED] SEND NICKNAME TO SERVER ---
            }),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        if (data.status) {
            showModal(data.qrString, data.orderId, selectedPackage.price, data.paymentUrl, data.expiresIn);
            startPolling(data.orderId);
        } else {
            showToast("Error: " + (data.message || "Unknown error"), "error");
            updateButtonState(); 
        }
    } catch (e) {
        showToast("Cannot reach server. Is main.py running?", "error");
        console.error("[handlePayment]", e);
        updateButtonState();
    }
}

// =============================================================================
// 5. POLLING
// =============================================================================

function startPolling(orderId) {
    stopPolling();
    pollStartTime = Date.now();

    pollInterval = setInterval(async () => {
        if (Date.now() - pollStartTime > MAX_POLL_MS) {
            stopPolling();
            showToast("Payment window expired. Please try again.", "error");
            closeModal();
            return;
        }

        try {
            const res  = await fetch(`${PAYMENT_API}/check-status/${orderId}`);
            const data = await res.json();

            switch (data.status) {
                case "SUCCESS":
                    stopPolling();
                    showSuccessScreen(
                        orderId,
                        data.product  || (selectedPackage ? selectedPackage.name : ''),
                        data.game_id  || (document.getElementById('gameId') || {}).value?.trim() || ''
                    );
                    break;

                case "PAID_BUT_DELIVERY_FAILED":
                    stopPolling();
                    showToast(
                        `Payment received! Delivery issue on #${orderId}. Staff will process manually.`,
                        "warning", 8000
                    );
                    closeModal();
                    break;

                // CamRapidPay returns "EXPIRED" (uppercased in check-status route)
                case "EXPIRED":
                    stopPolling();
                    showToast("QR code expired. Please start a new payment.", "error", 6000);
                    closeModal();
                    break;

                case "NOT_FOUND":
                    stopPolling();
                    showToast("Order not found. Contact support.", "error");
                    closeModal();
                    break;

                case "ERROR":
                    console.warn("[poll] Server error:", data.message);
                    break;

                // "PENDING" — keep polling silently
                default:
                    break;
            }
        } catch (e) {
            console.log("[poll] Waiting for payment...");
        }
    }, POLL_INTERVAL_MS);
}

function stopPolling() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

// =============================================================================
// 6. MODAL — open / close
// =============================================================================

/**
 * @param {string} qr          — QR string from CamRapidPay (qr_code field)
 * @param {string} orderId     — e.g. "ORD-A1B2C3D4"
 * @param {number} price       — e.g. 2.39
 * @param {string} paymentUrl  — CamRapidPay checkout URL (optional deep-link)
 * @param {string} expiresIn   — e.g. "5 minutes"
 */
function showModal(qr, orderId, price, paymentUrl = '', expiresIn = '5 minutes') {
    const modal = document.getElementById('paymentModal');
    if (!modal) return;

    modal.classList.remove('hidden');
    modal.classList.add('modal-active');

    const amountEl  = document.getElementById('modalAmount');
    const orderEl   = document.getElementById('modalOrderId');
    const qrWrapper = document.getElementById('qrcode');
    const expireEl  = document.getElementById('modalExpires');
    const linkEl    = document.getElementById('modalPaymentLink');

    if (amountEl)  amountEl.innerText  = price.toFixed(2);
    if (orderEl)   orderEl.innerText   = `#${orderId}`;
    if (expireEl)  expireEl.innerText  = `Expires in ${expiresIn}`;

    // Show/hide the "Open in Bakong" deep-link button
    if (linkEl) {
        if (paymentUrl) {
            linkEl.href          = paymentUrl;
            linkEl.style.display = 'inline-flex';
        } else {
            linkEl.style.display = 'none';
        }
    }

   // Render QR code
if (qrWrapper) {
    qrWrapper.innerHTML = "";
    new QRCode(qrWrapper, {
        text:         qr,
        width:        256,             // ទំហំនេះគឺល្អបំផុត ច្បាស់ល្អ
        height:       256,
        colorDark :   "#000000",
        colorLight :  "#ffffff",
        correctLevel: QRCode.CorrectLevel.H // ប្តូរមក Level L ដើម្បីឱ្យ QR ងាយស្រួលស្កេនបំផុត
    });
}
}
function closeModal() {
    stopPolling();
    const modal = document.getElementById('paymentModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('modal-active');
    }

    // Reset the "Processing..." button back to "Pay Now"
    updateButtonState(); 

    // Important: Put the QR design back for the next purchase
    resetModalUI(); 
}



function resetModalUI() {
    const sheet = document.getElementById('modalSheet');
    if (!sheet) return;

    sheet.innerHTML = `
        <!-- RED HEADER -->
        <div class="bg-[#E31E24] pt-1 pb-8 flex flex-col items-center relative">
            <div class="w-10 h-1 bg-white/30 rounded-full mb-4"></div>
            <img src="https://saktopup.com/assets/icon/KHQR.png" class="h-10" alt="KHQR">
            <button onclick="closeModal()" class="absolute right-6 top-6 text-white/90">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        </div>

        <!-- WHITE CONTENT -->
        <div class="bg-white -mt-6 rounded-t-[2rem] relative px-8 pt-8 pb-10">
            <div class="text-left mb-100 px-12">
                <p class="text-[14px] font-bold text-gray-800">Irra Topup</p>
                <div class="flex items-baseline justify-start gap-1">
                    <span id="modalAmount" class="text-3xl font-black text-gray-900 leading-none">0.00</span>
                    <span class="text-xs font-bold text-gray-500 uppercase">USD</span>
                </div>
            </div>

            <div class="border-t border-dashed border-gray-300 w-full my-4"></div>

           <!-- QR CODE SECTION WITH LOGO OVERLAY -->
            <div class="flex justify-center mb-5">
    <div class="relative p-3 bg-white rounded-xl border border-gray-100 shadow-sm">
        <div id="qrcode" class="p-1 bg-white flex items-center justify-center"></div>
        
        <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div class="bg-[#1a2b48] border-2 border-white w-9 h-9 rounded-full flex items-center justify-center shadow-md">
                <span class="text-white text-lg font-bold">$</span>
            </div>
        </div>
    </div>
</div>

            <!-- KHMER WARNING SECTION -->
            <div class="mt-4 space-y-2 text-center px-4">
                <p class="text-[11px] text-gray-500 font-medium uppercase tracking-tight">
                    Scan KHQR with any Banking App
                </p>
                
                <div class="bg-amber-50 border border-amber-100 p-3 rounded-2xl khmer">
                    <p class="text-[12px] text-amber-800 font-bold leading-relaxed">
                        ⚠️​​ បន្ទាប់ពីបង់ប្រាក់រួច សូមមេត្តាចាំបន្តិចរង់ចាំផ្ទាំង <br> 
                        <span class="text-blue-600 font-black">"SUCCESS"</span> បង្ហាញឡើង ទើបពេជ្រចូលគណនី!
                    </p>
                    <p class="text-[10px] text-amber-600 mt-2 font-medium">
                        (សូមកុំបិទផ្ទាំងនេះភ្លាមៗក្រោយពេលបង់ប្រាក់រួច)
                    </p>
                </div>
            </div>
        </div>
    `;
}
// =============================================================================
// 7. SUCCESS SCREEN
// =============================================================================
function showSuccessScreen(orderId, productName, gameId) {
    const modal = document.getElementById('paymentModal');
    const sheet = document.getElementById('modalSheet'); 
    if (!sheet) return;

    // 1. Professional Design with animated pulse and better spacing
    sheet.innerHTML = `
        <div class="py-12 px-8 text-center bg-white rounded-t-[2.5rem] shadow-2xl relative overflow-hidden">
            <!-- Background Decorative Pulse -->
            <div class="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-green-50 rounded-full blur-3xl opacity-50 -z-10"></div>
            
            <!-- Animated Success Icon -->
            <div class="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center
                        mx-auto mb-6 shadow-xl shadow-green-100 ring-8 ring-green-50">
                <i class="fas fa-check text-5xl text-white"></i>
            </div>
            
            <h2 class="text-3xl font-black text-slate-800 mb-1 uppercase tracking-widest oswald italic">SUCCESSFUL!</h2>
            <p class="text-green-600 font-bold text-sm mb-8">Items have been sent to your account 💎</p>
            
            <!-- Info Box -->
            <div class="bg-slate-50 rounded-[1.5rem] p-6 mb-8 text-left space-y-4 border border-slate-100 shadow-sm">
                <div class="flex justify-between items-center border-b border-slate-200/50 pb-3">
                    <span class="text-slate-400 text-[10px] font-black uppercase tracking-widest">Order Reference</span>
                    <span class="text-slate-800 font-black font-mono text-sm">#${orderId}</span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-slate-400 text-[10px] font-black uppercase tracking-widest">Product Details</span>
                    <span class="text-blue-600 font-black text-sm">${productName}</span>
                </div>
            </div>

            <!-- 20s Countdown Indicator -->
            <div class="flex flex-col items-center gap-3 mb-2">
                <p id="autoCloseText" class="text-[11px] text-slate-400 font-bold uppercase tracking-widest">
                    Auto-closing in 20s
                </p>
                <!-- Simple Progress Bar -->
                <div class="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                    <div id="progressBar" class="h-full bg-blue-500 transition-all duration-1000 ease-linear" style="width: 100%"></div>
                </div>
            </div>

            <button onclick="closeModal()"
                    class="mt-6 w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-sm tracking-widest 
                           uppercase active:scale-95 transition-all shadow-lg shadow-slate-200">
                Return to Shop
            </button>
        </div>
    `;

    // 2. Pro Timer Logic (20 Seconds)
    let timeLeft = 20;
    const timer = setInterval(() => {
        timeLeft--;
        const textEl = document.getElementById('autoCloseText');
        const barEl  = document.getElementById('progressBar');
        
        if (textEl) textEl.innerText = `Auto-closing in ${timeLeft}s`;
        if (barEl)  barEl.style.width = `${(timeLeft / 20) * 100}%`;
        
        if (timeLeft <= 0) {
            clearInterval(timer);
            closeModal();
        }
    }, 1000);

    // Stop timer if user manually clicks "Return to Shop"
    window.successTimer = timer; 
}

// =============================================================================
// 8. TOAST NOTIFICATIONS
// =============================================================================

function showToast(message, type = "info", duration = 4000) {
    const existing = document.getElementById('irra-toast');
    if (existing) existing.remove();

    const colours = {
        success: "bg-green-600",
        error:   "bg-red-600",
        warning: "bg-yellow-500",
        info:    "bg-blue-600",
    };
    const icons = {
        success: "fa-check-circle",
        error:   "fa-times-circle",
        warning: "fa-exclamation-triangle",
        info:    "fa-info-circle",
    };

    const toast         = document.createElement('div');
    toast.id            = 'irra-toast';
    toast.className     = `fixed bottom-24 left-1/2 -translate-x-1/2 z-[9999]
                           flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl
                           text-white text-sm font-medium transition-all duration-300
                           opacity-0 translate-y-4 ${colours[type] || colours.info}`;
    toast.style.maxWidth = "90vw";
    toast.innerHTML      = `<i class="fas ${icons[type] || icons.info}"></i> ${message}`;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.remove('opacity-0', 'translate-y-4'));
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-4');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, duration);
}

// =============================================================================
// 9. CAMRAPID PROXY HELPERS (admin / dashboard use)
// =============================================================================

async function fetchResellerProfile() {
    try {
        const res  = await fetch(`${PAYMENT_API}/api/profile`);
        const data = await res.json();
        return data.status === "SUCCESS" ? data.profile : null;
    } catch (e) { console.error("[fetchResellerProfile]", e); return null; }
}

async function fetchProductCatalogue(catalogId = null) {
    try {
        const url  = catalogId
            ? `${PAYMENT_API}/api/products/${catalogId}`
            : `${PAYMENT_API}/api/products`;
        const res  = await fetch(url);
        const data = await res.json();
        return data.status === "SUCCESS" ? (data.products || []) : [];
    } catch (e) { console.error("[fetchProductCatalogue]", e); return []; }
}

async function fetchCatalogs() {
    try {
        const res  = await fetch(`${PAYMENT_API}/api/catalogs`);
        const data = await res.json();
        return data.status === "SUCCESS" ? (data.catalogs || []) : [];
    } catch (e) { console.error("[fetchCatalogs]", e); return []; }
}

async function fetchFundingHistory() {
    try {
        const res  = await fetch(`${PAYMENT_API}/api/funding-history`);
        const data = await res.json();
        return data.status === "SUCCESS" ? (data.funding_history || []) : [];
    } catch (e) { console.error("[fetchFundingHistory]", e); return []; }
}

async function fetchOrdersHistory() {
    try {
        const res  = await fetch(`${PAYMENT_API}/api/orders-history`);
        const data = await res.json();
        return data.status === "SUCCESS" ? (data.last_transactions || []) : [];
    } catch (e) { console.error("[fetchOrdersHistory]", e); return []; }
}

// =============================================================================
// 10. INIT
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
    loadPackages();
    updateButtonState();

    window.addEventListener('verificationChanged', updateButtonState);

    const modal = document.getElementById('paymentModal');
    if (modal) {
        modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    }

    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
});
