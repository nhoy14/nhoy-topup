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
const GAME_TYPE   = "mlbb-kh"; // Changed from mlbb-kh to mlbb-ph

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

// 1. Updated LOAD PACKAGES to fetch PH data
async function loadPackages() {
    const container = document.getElementById('packageContainer');
    if (!container) return;

    container.innerHTML = `<div class="col-span-full text-center text-white/40 py-8">
        <i class="fas fa-circle-notch fa-spin mr-2"></i> Loading PH Packages...</div>`;

    try {
        // We add ?game=mlbb-ph to the URL
        const res  = await fetch(`${PAYMENT_API}/api/packages?game=${GAME_TYPE}`);
        const data = await res.json();

        if (data.status !== "SUCCESS" || !data.packages?.length) {
            container.innerHTML = `<p class="col-span-full text-center text-red-400 py-8">Failed to load PH packages.</p>`;
            return;
        }

        packages = data.packages;
        renderPackages();
    } catch (e) {
        console.error("[loadPackages]", e);
        container.innerHTML = `<p class="col-span-full text-center text-red-400 py-8">SERVER ERROR</p>`;
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
                <p class="text-[9px] text-white/60 leading-tight uppercase font-medium mt-0.5">
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

// 2. Updated HANDLE PAYMENT to tell backend this is a PH order
async function handlePayment() {
    if (!selectedPackage) return;

    const gid = (document.getElementById('gameId')   || {}).value?.trim() || '';
    const sid = (document.getElementById('serverId') || {}).value?.trim() || '';
    if (!gid) { showToast("Please enter your Game ID.", "error"); return; }

    const btn = document.getElementById('payBtn');
    if (btn) {
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i> Processing...';
        btn.disabled  = true;
    }

    try {
        const response = await fetch(`${PAYMENT_API}/create-payment`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                game:      GAME_TYPE, // This tells the backend to use the PH pool
                packageId: selectedPackage.id,
                gameId:    gid,
                serverId:  sid,
                nickname:  window.currentNickname || 'N/A' // assuming your verify script saves this
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
        showToast("Cannot reach server.", "error");
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
    const modal = document.getElementById('paymentModal');
    if (!modal) return;

    // We use the ID "modalSheet" which matches your HTML structure
    const inner = document.getElementById('modalSheet');
    if (!inner) return;

    inner.innerHTML = `
        <div class="py-10 px-6 text-center bg-white rounded-t-[2.5rem]">
            <div class="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center
                        mx-auto mb-5 shadow-xl shadow-green-200 animate-bounce">
                <i class="fas fa-check text-4xl text-white"></i>
            </div>
            <h2 class="text-2xl font-black text-slate-800 mb-1 uppercase tracking-widest oswald">SUCCESS!</h2>
            <p class="text-green-600 font-bold text-sm mb-6">Diamonds delivered! 💎</p>
            
            <div class="bg-slate-50 rounded-2xl p-5 mb-6 text-left space-y-3 border border-slate-100">
                <div class="flex justify-between text-xs">
                    <span class="text-slate-400 font-medium uppercase">Order ID</span>
                    <span class="text-slate-800 font-bold">#${orderId}</span>
                </div>
                <div class="flex justify-between text-xs">
                    <span class="text-slate-400 font-medium uppercase">Product</span>
                    <span class="text-slate-800 font-bold">${productName}</span>
                </div>
            </div>

            <p class="text-[10px] text-gray-400 mb-4 italic">This window will close automatically...</p>

            <button onclick="closeModal()"
                    class="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl
                           font-bold text-base active:scale-95 transition-all shadow-lg shadow-blue-100">
                DONE
            </button>
        </div>
    `;

    // --- AUTO CLOSE LOGIC ---
    // Closes the modal and resets the "Processing" button after 5 seconds
    setTimeout(() => {
        // Only close if the success screen is still visible
        if (!modal.classList.contains('hidden')) {
            closeModal();
        }
    }, 5000); 
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
