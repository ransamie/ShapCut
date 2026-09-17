document.addEventListener('DOMContentLoaded', () => {
    // 1. Detect Operating System
    const userAgent = window.navigator.userAgent.toLowerCase();
    let detectedOS = 'windows'; // default fallback
    let osName = 'Windows';
    let downloadHref = 'https://github.com/ransamie/ShapCut/releases/latest/download/ShapCut.Setup.1.0.0.exe';
    let fileExt = '.exe';

    if (userAgent.indexOf('mac') !== -1) {
        detectedOS = 'mac';
        osName = 'macOS';
        downloadHref = 'https://github.com/ransamie/ShapCut/releases/latest/download/ShapCut-1.0.0.dmg';
        fileExt = '.dmg';
    } else if (userAgent.indexOf('linux') !== -1 || userAgent.indexOf('x11') !== -1) {
        detectedOS = 'linux';
        osName = 'Linux';
        downloadHref = 'https://github.com/ransamie/ShapCut/releases/latest/download/ShapCut-1.0.0.AppImage';
        fileExt = '.AppImage';
    }

    // 2. Personalize Primary Download Button
    const heroBtn = document.getElementById('primary-download-btn');
    if (heroBtn) {
        heroBtn.innerHTML = `<span>Download for ${osName}</span> <span style="opacity:0.75; font-size:0.85em;">(${fileExt})</span>`;
        heroBtn.setAttribute('href', downloadHref);
    }

    // 3. Highlight Detected OS Card
    const targetCard = document.getElementById(`card-${detectedOS}`);
    if (targetCard) {
        targetCard.classList.add('detected-os');
        const badge = document.createElement('div');
        badge.className = 'os-badge-pill';
        badge.innerText = 'Detected for your OS';
        targetCard.appendChild(badge);
    }

    // 4. Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                targetElement.scrollIntoView({
                    behavior: 'smooth'
                });
            }
        });
    });

    // 5. Intersection Observer for reveal animations
    const revealElements = document.querySelectorAll('.reveal');
    const revealOptions = {
        threshold: 0.15,
        rootMargin: "0px 0px -50px 0px"
    };

    const revealOnScroll = new IntersectionObserver(function(entries, observer) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                observer.unobserve(entry.target);
            }
        });
    }, revealOptions);

    revealElements.forEach(el => {
        revealOnScroll.observe(el);
    });

    // 6. Optional: Update release links dynamically from GitHub Releases API
    fetch('https://api.github.com/repos/ransamie/ShapCut/releases/latest')
        .then(response => {
            if (!response.ok) return null;
            return response.json();
        })
        .then(data => {
            if (!data || !data.assets) return;
            
            const winAsset = data.assets.find(a => a.name.endsWith('.exe'));
            const macAsset = data.assets.find(a => a.name.endsWith('.dmg'));
            const linuxAsset = data.assets.find(a => a.name.endsWith('.AppImage'));

            if (winAsset) {
                const btn = document.getElementById('btn-download-windows');
                if (btn) btn.href = winAsset.browser_download_url;
                if (detectedOS === 'windows' && heroBtn) heroBtn.href = winAsset.browser_download_url;
            }
            if (macAsset) {
                const btn = document.getElementById('btn-download-mac');
                if (btn) btn.href = macAsset.browser_download_url;
                if (detectedOS === 'mac' && heroBtn) heroBtn.href = macAsset.browser_download_url;
            }
            if (linuxAsset) {
                const btn = document.getElementById('btn-download-linux');
                if (btn) btn.href = linuxAsset.browser_download_url;
                if (detectedOS === 'linux' && heroBtn) heroBtn.href = linuxAsset.browser_download_url;
            }
        })
        .catch(err => {
            console.log('GitHub API info:', err);
        });
});
