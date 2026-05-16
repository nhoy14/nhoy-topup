/** 
 * SCRIPT: MLBB ID CHECKER (Strict KH Region Only)
 */
const BASE_API_URL = "https://v1.camrapidx.com/validate_user/";
const GAME_FILE = "Mobile_Legends_KH.php"; 
let isVerified = false; 

/**
 * 1. Function to Enable/Disable Button based on input length
 */
function validateInputs() {
    const gid = document.getElementById('gameId').value;
    const sid = document.getElementById('serverId').value;
    const btn = document.getElementById('checkBtn');

    if (gid.length >= 5 && sid.length >= 3) {
        btn.disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
        btn.classList.add('opacity-100', 'cursor-pointer');
    } else {
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        btn.classList.remove('opacity-100', 'cursor-pointer');
    }
}

/**
 * 2. Manual Check Logic with KH Region Enforcement
 */
async function checkNickname() {
    const gid = document.getElementById('gameId').value;
    const sid = document.getElementById('serverId').value;
    const display = document.getElementById('playerNickname');
    const btn = document.getElementById('checkBtn');
    
    isVerified = false;
    
    // UI Loading State
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Verifying...`;
    display.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i>`;
    display.className = "text-blue-400 font-bold italic text-right";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
        const endpoint = `${BASE_API_URL}${GAME_FILE}?UserID=${encodeURIComponent(gid)}&ZoneID=${encodeURIComponent(sid)}`;
        const res = await fetch(endpoint, { signal: controller.signal });
        const data = await res.json();
        clearTimeout(timeoutId);

        // STRICT LOGIC: Status must be APPROVED AND Region must be KH
        if(data.status === "APPROVED" && data.region === "KH") {
            display.innerHTML = `<i class="fas fa-check-circle mr-1"></i> ${data.username}`;
            display.className = "text-green-400 font-bold italic text-right";
            isVerified = true;
            btn.innerHTML = `<span>Verified</span>`;
        } 
        else if (data.status === "APPROVED" && data.region !== "KH") {
            // Case where ID is valid but region is NOT Cambodia
            display.innerHTML = `Region ${data.region} Not Allowed`;
            display.className = "text-red-400 font-bold italic text-right";
            btn.innerHTML = `<span>Invalid Region</span>`;
            isVerified = false;
        }
        else {
            // Case: NOT_ALLOW or general failure
            display.innerHTML = `Invalid ID or Zone`;
            display.className = "text-red-400 font-bold italic text-right";
            btn.innerHTML = `<span>Try Again</span>`;
            isVerified = false;
        }
    } catch(e) { 
        display.innerText = (e.name === 'AbortError') ? "Request Timeout" : "API Offline";
        btn.innerHTML = `<span>Error</span>`;
    } finally {
        btn.disabled = false;
        validateInputs(); 
        if (typeof updateButtonState === "function") updateButtonState();
    }
}

/**
 * 3. Restrict to Numbers Only & Reset Status
 */
function handleNumberInput(e) {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
    const display = document.getElementById('playerNickname');
    
    isVerified = false;
    display.innerText = "Not Checked";
    display.className = "text-gray-400 font-bold italic text-right";
    
    validateInputs();
    if (typeof updateButtonState === "function") updateButtonState();
}

// 4. Event Listeners
document.getElementById('gameId').addEventListener('input', handleNumberInput);
document.getElementById('serverId').addEventListener('input', handleNumberInput);
document.getElementById('checkBtn').addEventListener('click', checkNickname);
