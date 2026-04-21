document.addEventListener('DOMContentLoaded', () => {
    const KTS_POINTS_KEY = 'ktsPoints';
    const KES_POINTS_KEY = 'kesPoints';
    const PRIZE_THRESHOLD = 100;

    const ktsPointsElement = document.getElementById('kts-points');
    const kesPointsElement = document.getElementById('kes-points');
    const ktsPrizeMessage = document.getElementById('kts-prize');
    const kesPrizeMessage = document.getElementById('kes-prize');
    const resetAllButton = document.getElementById('reset-all');

    let ktsPoints = parseInt(localStorage.getItem(KTS_POINTS_KEY) || '16');
    let kesPoints = parseInt(localStorage.getItem(KES_POINTS_KEY) || '15');

    function updatePointsDisplay(kid, points) {
        if (kid === 'kts') {
            ktsPointsElement.textContent = points;
            localStorage.setItem(KTS_POINTS_KEY, points);
        } else if (kid === 'kes') {
            kesPointsElement.textContent = points;
            localStorage.setItem(KES_POINTS_KEY, points);
        }
        checkPrizeStatus(kid, points);
    }

    function checkPrizeStatus(kid, points) {
        const prizeMessageElement = kid === 'kts' ? ktsPrizeMessage : kesPrizeMessage;
        if (points >= PRIZE_THRESHOLD) {
            prizeMessageElement.innerHTML = '🎉 PRIZE TIME! 🎉';
            triggerConfetti();
        } else {
            prizeMessageElement.textContent = '';
        }
    }

    function handlePointChange(event) {
        const button = event.target;
        const kid = button.dataset.kid;
        const pointsToAdd = parseInt(button.dataset.points);

        if (kid === 'kts') {
            ktsPoints += pointsToAdd;
            if (ktsPoints < 0) ktsPoints = 0; // Prevent negative points
            updatePointsDisplay('kts', ktsPoints);
        } else if (kid === 'kes') {
            kesPoints += pointsToAdd;
            if (kesPoints < 0) kesPoints = 0; // Prevent negative points
            updatePointsDisplay('kes', kesPoints);
        }
    }

    function triggerConfetti() {
        const colors = ['#ffeb3b', '#ff4081', '#2196f3', '#4caf50', '#ff9800'];
        for (let i = 0; i < 50; i++) {
            const confetti = document.createElement('div');
            confetti.classList.add('confetti');
            confetti.style.left = Math.random() * 100 + 'vw';
            confetti.style.animationDuration = Math.random() * 2 + 3 + 's'; // 3-5 seconds
            confetti.style.animationDelay = Math.random() * 0.5 + 's';
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            document.body.appendChild(confetti);

            confetti.addEventListener('animationend', () => {
                confetti.remove();
            });
        }
    }

    // Initial display update
    updatePointsDisplay('kts', ktsPoints);
    updatePointsDisplay('kes', kesPoints);

    document.querySelectorAll('.add-btn').forEach(button => {
        button.addEventListener('click', handlePointChange);
    });

    document.querySelectorAll('.subtract-btn').forEach(button => {
        button.addEventListener('click', handlePointChange);
    });

    resetAllButton.addEventListener('click', () => {
        if (confirm('Are you sure you want to reset all points?')) {
            ktsPoints = 0;
            kesPoints = 0;
            updatePointsDisplay('kts', ktsPoints);
            updatePointsDisplay('kes', kesPoints);
            alert('All points have been reset!');
        }
    });
});
