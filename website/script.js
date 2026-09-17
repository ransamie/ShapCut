/**
 * ShapCut Landing Page Script
 * Interactivity, OS Detection, Waveform Synthesis & Responsive Navigation
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Detect Operating System
    const userAgent = window.navigator.userAgent.toLowerCase();
    let detectedOS = 'windows'; // default fallback
    let osName = 'Windows';
    let downloadHref = 'https://github.com/ransamie/ShapCut/releases/latest/download/ShapCut-Setup-1.0.0.exe';
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

    // 2. Personalize Primary Download Button with Icon & OS info
    const heroBtn = document.getElementById('primary-download-btn');
    if (heroBtn) {
        heroBtn.innerHTML = `
            <svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span>Download for ${osName}</span>
            <span class="btn-ext">(${fileExt})</span>
        `;
        heroBtn.setAttribute('href', downloadHref);
    }

    // 3. Highlight Detected OS Card
    const targetCard = document.getElementById(`card-${detectedOS}`);
    if (targetCard) {
        targetCard.classList.add('detected-os');
        const badge = document.createElement('div');
        badge.className = 'os-badge-pill';
        badge.innerText = 'Detected for your OS';
        targetCard.prepend(badge);
    }

    // 4. Sticky Navbar Scroll Treatment
    const navbar = document.getElementById('navbar');
    const handleScroll = () => {
        if (window.scrollY > 20) {
            navbar.classList.add('navbar-scrolled');
        } else {
            navbar.classList.remove('navbar-scrolled');
        }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    // 5. Smooth Scrolling for Anchor Links (with navbar offset)
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#' || !targetId) return;

            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                e.preventDefault();
                const navHeight = navbar ? navbar.offsetHeight : 64;
                const elementPosition = targetElement.getBoundingClientRect().top + window.scrollY;
                const offsetPosition = elementPosition - navHeight - 16;

                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });

    // 6. Intersection Observer for Scroll Reveals
    const revealElements = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window) {
        const revealOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -40px 0px'
        };

        const revealOnScroll = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('active');
                    observer.unobserve(entry.target);
                }
            });
        }, revealOptions);

        revealElements.forEach(el => revealOnScroll.observe(el));
    } else {
        // Fallback for older browsers
        revealElements.forEach(el => el.classList.add('active'));
    }

    // 7. Dynamic Release Assets from GitHub API (Graceful degradation)
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
            // Silently fallback to static release URLs
        });

    // 8. Generate Responsive Waveform Audio Track
    const waveformContainer = document.getElementById('mockupWaveform');
    if (waveformContainer) {
        // Balanced speech energy profile across timeline
        const barHeights = [
            10, 14, 24, 34, 38, 30, 18, 9, 6, 20, 32, 42, 38, 26, 12, 8,
            22, 36, 44, 32, 20, 10, 28, 40, 36, 22, 12, 26, 38, 34, 18, 6,
            16, 30, 40, 32, 20, 9, 24, 38, 42, 34, 22, 11, 26, 36, 32, 16,
            8, 20, 34, 42, 36, 24, 12, 28, 40, 38, 26, 14, 24, 36, 32, 18,
            9, 22, 38, 40, 32, 20, 10, 26, 40, 36, 24, 12, 22, 34, 38, 28,
            14, 7, 24, 38, 42, 34, 22, 9, 28, 40, 36, 24, 12, 26, 38, 32,
            16, 7, 20, 32, 40, 34, 22, 11, 24, 36, 30, 18, 9, 5, 12, 18
        ];

        waveformContainer.innerHTML = '';
        barHeights.forEach((h, idx) => {
            const bar = document.createElement('div');
            bar.className = 'wave-bar';
            bar.style.height = `${Math.round(h * 0.9)}px`;

            // Color cut segment bars with teal highlight
            const pct = (idx / barHeights.length) * 100;
            if (
                (pct >= 6.8 && pct <= 9.2) ||
                (pct >= 36.0 && pct <= 38.8) ||
                (pct >= 40.5 && pct <= 51.5) ||
                (pct >= 71.5 && pct <= 74.0) ||
                (pct >= 86.5 && pct <= 89.2)
            ) {
                bar.style.background = '#14b8a6';
                bar.style.boxShadow = '0 0 5px rgba(20, 184, 166, 0.6)';
            }
            waveformContainer.appendChild(bar);
        });
    }

    // 9. Mobile Navigation Toggle & Touch Experience
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const navLinks = document.getElementById('navLinks');

    if (mobileMenuBtn && navLinks) {
        const toggleMenu = () => {
            const isOpen = mobileMenuBtn.classList.toggle('active');
            navLinks.classList.toggle('active');
            mobileMenuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            document.body.classList.toggle('menu-open', isOpen);
        };

        const closeMenu = () => {
            mobileMenuBtn.classList.remove('active');
            navLinks.classList.remove('active');
            mobileMenuBtn.setAttribute('aria-expanded', 'false');
            document.body.classList.remove('menu-open');
        };

        mobileMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMenu();
        });

        // Close when clicking any menu link
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', closeMenu);
        });

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && navLinks.classList.contains('active')) {
                closeMenu();
            }
        });

        // Close when clicking outside of nav
        document.addEventListener('click', (e) => {
            if (
                navLinks.classList.contains('active') &&
                !navLinks.contains(e.target) &&
                !mobileMenuBtn.contains(e.target)
            ) {
                closeMenu();
            }
        });
    }

    // 10. FAQ Accordion: Exclusive Open Behavior
    const faqAccordions = document.querySelectorAll('.faq-accordion');
    faqAccordions.forEach(details => {
        details.addEventListener('toggle', () => {
            if (details.open) {
                faqAccordions.forEach(otherDetails => {
                    if (otherDetails !== details && otherDetails.open) {
                        otherDetails.open = false;
                    }
                });
            }
        });
    });
});

// 11. Mockup View Switcher (Global handler for segmented control)
function switchMockupView(view) {
    const codeView = document.getElementById('mockup-code-view');
    const photoView = document.getElementById('mockup-photo-view');
    const btnCode = document.getElementById('btn-show-code');
    const btnPhoto = document.getElementById('btn-show-photo');

    if (view === 'photo') {
        if (codeView) codeView.style.display = 'none';
        if (photoView) photoView.style.display = 'block';
        if (btnCode) {
            btnCode.classList.remove('active');
            btnCode.setAttribute('aria-selected', 'false');
        }
        if (btnPhoto) {
            btnPhoto.classList.add('active');
            btnPhoto.setAttribute('aria-selected', 'true');
        }
    } else {
        if (codeView) codeView.style.display = 'block';
        if (photoView) photoView.style.display = 'none';
        if (btnCode) {
            btnCode.classList.add('active');
            btnCode.setAttribute('aria-selected', 'true');
        }
        if (btnPhoto) {
            btnPhoto.classList.remove('active');
            btnPhoto.setAttribute('aria-selected', 'false');
        }
    }
}
