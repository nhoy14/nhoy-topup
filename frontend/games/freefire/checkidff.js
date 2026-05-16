/**
 * id.js — Free Fire UID Checker
 */

const gameIdInput = document.getElementById('gameId');
const checkBtn = document.getElementById('checkBtn');
const checkBtnText = document.getElementById('checkBtnText');
const playerNickname = document.getElementById('playerNickname');

// Global state to tell the payment script if the ID is valid
window.isVerified = false;

// Enable/Disable check button based on input length
gameIdInput.addEventListener('input', () => {
    const val = gameIdInput.value.trim();
    checkBtn.disabled = val.length < 5;
    
    // If user changes the ID after verifying, reset verification
    if (window.isVerified) {
        window.isVerified = false;
        playerNickname.innerText = "Not Checked";
        playerNickname.className = "text-red-400 font-bold italic";
        // Notify paymentff.js to disable Pay button
        window.dispatchEvent(new Event('verificationChanged'));
    }
});

async function checkNickname() {
    const userId = gameIdInput.value.trim();
    if (!userId) return;

    // UI State: Loading
    checkBtn.disabled = true;
    checkBtnText.innerHTML = `<span class="spinner"></span> Checking...`;
    playerNickname.innerText = "Verifying...";
    playerNickname.className = "text-[#10b981] font-bold italic animate-pulse";

    try {
        // API Endpoint for Free Fire Global
        const url = `https://v1.camrapidx.com/validate_user/FreeFire_Global.php?UserID=${encodeURIComponent(userId)}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.status === "APPROVED") {
            // SUCCESS
            playerNickname.innerText = data.username;
            playerNickname.className = "text-green-400 font-bold italic";
            window.isVerified = true;
        } else {
            // FAILED (ID not found)
            playerNickname.innerText = "ID Not Found";
            playerNickname.className = "text-red-500 font-bold italic";
            window.isVerified = false;
        }

    } catch (error) {
        // CONNECTION ERROR
        playerNickname.innerText = "Connection Error";
        playerNickname.className = "text-yellow-500 font-bold italic";
        window.isVerified = false;
    } finally {
        // Restore button
        checkBtn.disabled = false;
        checkBtnText.innerText = "Check Nickname";
        
        // 🔥 CRITICAL: Tell paymentff.js to check the button state again
        window.dispatchEvent(new Event('verificationChanged'));
    }
}