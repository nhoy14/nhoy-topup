/**
 * SCRIPT: MLBB ID CHECKER (Strict PH Region Only)
 */
const BASE_API_URL = "https://v1.camrapidx.com/validate_user/";
// If PH.php failed, we use the standard file. Most providers handle all regions here.
const GAME_FILE = "Mobile_Legends_KH.php"; 
let isVerified = false; 

/**
 * 1. Function to Enable/Disable Button based on input length
 */
function validateInputs() {
    const gid = document.getElementById('gameId').value;
    const sid = document.getElementById('serverId').value;
    const btn = document.getElementById('checkBtn');

    if (gid && sid && gid.length >= 5 && sid.length >= 3) {
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
 * 2. Manual Check Logic with PH Region Enforcement
 */
async function checkNickname() {
    const gid = document.getElementById('gameId').value.trim();
    const sid = document.getElementById('serverId').value.trim();
    const display = document.getElementById('playerNickname');
    const btn = document.getElementById('checkBtn');
    
    isVerified = false;
    
    // UI Loading State
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Verifying...`;
    display.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Checking...`;
    display.className = "text-blue-400 font-bold italic text-right";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
        // We use the standard file but the logic below will filter for PH
        const endpoint = `${BASE_API_URL}${GAME_FILE}?UserID=${gid}&ZoneID=${sid}`;
        
        const res = await fetch(endpoint, { signal: controller.signal });
        
        if (!res.ok) throw new Error("Server Error");
        
        const data = await res.json();
        clearTimeout(timeoutId);

        // DEBUG: Uncomment the line below to see the exact data in your browser console
        // console.log("API Response:", data);

        // LOGIC: Check if it is PH region
        if(data.status === "APPROVED" && (data.region === "PH" || data.region === "philippines")) {
            display.innerHTML = `<i class="fas fa-check-circle mr-1"></i> ${data.username}`;
            display.className = "text-green-400 font-bold italic text-right";
            isVerified = true;
            btn.innerHTML = `<span>Verified</span>`;
            window.currentNickname = data.username;
        } 
        else if (data.status === "APPROVED" && data.region !== "PH") {
            // Valid ID but wrong region (e.g., KH, ID, MY)
            display.innerHTML = `Region ${data.region} Not Allowed`;
            display.className = "text-red-400 font-bold italic text-right";
            btn.innerHTML = `<span>INVALID REGION</span>`;
            isVerified = false;
        }
        else {
            // Status is NOT_ALLOW or User not found
            display.innerHTML = `ID Not Found`;
            display.className = "text-red-400 font-bold italic text-right";
            btn.innerHTML = `<span>Invalid</span>`;
            isVerified = false;
        }
    } catch(e) { 
        console.error("Checker Error:", e);
        display.innerText = "API Offline";
        btn.innerHTML = `<span>Try Again</span>`;
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