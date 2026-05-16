/**
 * ff.js — IRRA TOPUP (Free Fire)
 * Mirrors payment.js exactly but:
 *   • fetches from /api/packages?game=ff  (or /api/packages/ff)
 *   • sends  game: "ff"  in every create-payment request
 *   • no zone/server field required for FF (uid only)
 * Depends on: QRCode.js, ff-checkid.js (exposes window.isVerified)
 */

// =============================================================================
// CONFIG
// =============================================================================

const PAYMENT_API      = "https://backendtopup.onrender.com"; // replace with tunnel URL when deployed
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_MS      = 10 * 60 * 1000; // 10 minutes

// =============================================================================
// STATE
// =============================================================================

let packages        = [];
let selectedPackage = null;
let pollInterval    = null;
let pollStartTime   = null;

// =============================================================================
// 1. LOAD + RENDER PACKAGES
// =============================================================================

async function loadPackages() {
    const container = document.getElementById('packageContainer');
    if (!container) return;

    container.innerHTML = `
        <div class="col-span-full text-center text-white/40 text-sm py-8">
            <i class="fas fa-circle-notch fa-spin mr-2"></i> Loading packages...
        </div>`;

    try {
        const res  = await fetch(`${PAYMENT_API}/api/packages/ff`);
        const data = await res.json();

        if (data.status !== "SUCCESS" || !data.packages?.length) {
            container.innerHTML = `<p class="col-span-full text-center text-red-400 text-sm py-8">
                Failed to load packages. Please refresh.</p>`;
            return;
        }

        packages = data.packages;
        renderPackages();

    } catch (e) {
        console.error("[ff loadPackages]", e);
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
                    flex items-center space-x-3 transition-all hover:border-[#10b981] relative">

            <div class="check-icon absolute top-1 right-1 w-5 h-5 bg-[#10b981] text-white text-xs
                        flex items-center justify-center rounded-full hidden shadow-md">
                ✓
            </div>

            <div class="relative">
                <img src="${pkg.image}"
                     class="w-10 h-10 rounded-lg object-cover shadow-lg"
                     alt="${pkg.name}" loading="lazy">
            </div>

            <div class="flex-1">
                <p class="text-[#10b981] font-bold text-base leading-tight">
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

    document.getElementById('displayTotal').innerText   = `$${selectedPackage.price.toFixed(2)}`;
    document.getElementById('displayProduct').innerText = selectedPackage.name;

    document.querySelectorAll('.package-card').forEach(el => {
        el.classList.remove('selected');
        const check = el.querySelector('.check-icon');
        if (check) check.classList.add('hidden');
    });

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
    const payBtn = document.getElementById('payBtn');
    if (!payBtn) return;

    const verified = (typeof isVerified !== 'undefined' && isVerified === true);

    if (selectedPackage && verified) {
        payBtn.disabled  = false;
        payBtn.innerHTML = '<span id="payBtnText">Pay Now</span>';
    } else {
        payBtn.disabled  = true;
        payBtn.innerHTML = '<span id="payBtnText">PAY NOW</span>';
    }
}

// =============================================================================
// 4. HANDLE PAYMENT
// =============================================================================

async function handlePayment() {
    if (!selectedPackage) return;

    const gid  = (document.getElementById('gameId')        || {}).value?.trim() || '';
    // FF uses UID only — zone field optional / may not exist on FF page
    const sid  = (document.getElementById('serverId')      || {}).value?.trim() || '';
    const nick = (document.getElementById('playerNickname')|| {}).innerText     || 'N/A';

    if (!gid) { showToast("Please enter your Game UID.", "error"); return; }

    const btn = document.getElementById('payBtn');
    if (btn) {
        btn.disabled  = true;
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
                game:      "ff",          // ← tells the server which package pool to use
                packageId: selectedPackage.id,
                gameId:    gid,
                serverId:  sid,
                nickname:  nick,
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
        console.error("[ff handlePayment]", e);
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
                        data.product || (selectedPackage ? selectedPackage.name : ''),
                        data.game_id || (document.getElementById('gameId') || {}).value?.trim() || ''
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
                    console.warn("[ff poll] Server error:", data.message);
                    break;
                default:
                    break;
            }
        } catch (e) {
            console.log("[ff poll] Waiting for payment...");
        }
    }, POLL_INTERVAL_MS);
}

function stopPolling() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

// =============================================================================
// 6. MODAL — open / close
// =============================================================================

function showModal(qr, orderId, price, paymentUrl = '', expiresIn = '5 minutes') {
    const modal = document.getElementById('paymentModal');
    if (!modal) return;

    modal.classList.remove('hidden');
    modal.classList.add('modal-active');

    const amountEl  = document.getElementById('modalAmount');
    const qrWrapper = document.getElementById('qrcode');

    if (amountEl) amountEl.innerText = price.toFixed(2);

    if (qrWrapper) {
        qrWrapper.innerHTML = "";
        new QRCode(qrWrapper, {
            text:         qr,
            width:        160,
            height:       160,
            correctLevel: QRCode.CorrectLevel.M,
        });
    }
}
function closeModal() {
    // 1. Stop the payment polling timer
    stopPolling();

    // 2. Hide the modal
    const modal = document.getElementById('paymentModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('modal-active');
    }

    // 3. Reset the "Pay Now" button (Removes 'Processing...' and re-enables)
    if (typeof updateButtonState === 'function') {
        updateButtonState();
    }

    // 4. Restore the QR Code layout (so it's ready for the next click)
    if (typeof resetModalUI === 'function') {
        resetModalUI();
    }
}

// =============================================================================
// 7. SUCCESS SCREEN
// =============================================================================

function showSuccessScreen(orderId, productName, gameId) {
    const sheet = document.getElementById('modalSheet');
    if (!sheet) return;

    sheet.innerHTML = `
        <div class="py-12 px-8 text-center bg-white rounded-t-[2.5rem] shadow-2xl relative overflow-hidden">
            <div class="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-emerald-50 rounded-full blur-3xl opacity-50 -z-10"></div>

            <div class="w-24 h-24 bg-[#10b981] rounded-full flex items-center justify-center
                        mx-auto mb-6 shadow-xl shadow-emerald-100 ring-8 ring-emerald-50">
                <i class="fas fa-check text-5xl text-white"></i>
            </div>

            <h2 class="text-3xl font-black text-slate-800 mb-1 uppercase tracking-widest oswald italic">SUCCESSFUL!</h2>
            <p class="text-[#10b981] font-bold text-sm mb-8">Diamonds have been sent to your account 🔥</p>

            <div class="bg-slate-50 rounded-[1.5rem] p-6 mb-8 text-left space-y-4 border border-slate-100 shadow-sm">
                <div class="flex justify-between items-center border-b border-slate-200/50 pb-3">
                    <span class="text-slate-400 text-[10px] font-black uppercase tracking-widest">Order Reference</span>
                    <span class="text-slate-800 font-black font-mono text-sm">#${orderId}</span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-slate-400 text-[10px] font-black uppercase tracking-widest">Product Details</span>
                    <span class="text-[#10b981] font-black text-sm">${productName}</span>
                </div>
            </div>

            <div class="flex flex-col items-center gap-3 mb-2">
                <p id="autoCloseText" class="text-[11px] text-slate-400 font-bold uppercase tracking-widest">
                    Auto-closing in 20s
                </p>
                <div class="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                    <div id="progressBar" class="h-full bg-[#10b981] transition-all duration-1000 ease-linear" style="width: 100%"></div>
                </div>
            </div>

            <button onclick="closeModal()"
                    class="mt-6 w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-sm tracking-widest
                           uppercase active:scale-95 transition-all shadow-lg shadow-slate-200">
                Return to Shop
            </button>
        </div>
    `;

    let timeLeft = 20;
    const timer = setInterval(() => {
        timeLeft--;
        const textEl = document.getElementById('autoCloseText');
        const barEl  = document.getElementById('progressBar');
        if (textEl) textEl.innerText = `Auto-closing in ${timeLeft}s`;
        if (barEl)  barEl.style.width = `${(timeLeft / 20) * 100}%`;
        if (timeLeft <= 0) { clearInterval(timer); closeModal(); }
    }, 1000);
    window.successTimer = timer;
}

// =============================================================================
// 8. TOAST NOTIFICATIONS
// =============================================================================

function showToast(message, type = "info", duration = 4000) {
    const existing = document.getElementById('irra-toast');
    if (existing) existing.remove();

    const colours = { success: "bg-green-600", error: "bg-red-600", warning: "bg-yellow-500", info: "bg-blue-600" };
    const icons   = { success: "fa-check-circle", error: "fa-times-circle", warning: "fa-exclamation-triangle", info: "fa-info-circle" };

    const toast          = document.createElement('div');
    toast.id             = 'irra-toast';
    toast.className      = `fixed bottom-24 left-1/2 -translate-x-1/2 z-[9999]
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
// 9. INIT
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
