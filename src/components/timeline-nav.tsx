import React, { useState, useEffect, useRef } from 'react';

interface Section {
  id: string;
  title: string;
}

const sections: Section[] = [
  { id: 'game-results-chart-container', title: 'Game Results' },
  { id: 'mistakes-analysis-chart-container', title: 'Error Analysis' },
  { id: 'opening-analysis-container', title: 'Opening Analysis' },
  { id: 'blunder-analysis-container', title: 'Blunder Analysis' },
  { id: 'time-analysis-container', title: 'Time Analysis' },
  { id: 'principles-summary-container', title: 'Principles Summary' },
  { id: 'custom-puzzles-container', title: 'Training Puzzles' }
];

export default function TimelineNav() {
  const [activeSection, setActiveSection] = useState<string>('');
  const [sectionPositions, setSectionPositions] = useState<Map<string, { top: number; bottom: number }>>(new Map());
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [scrollY, setScrollY] = useState<number>(0);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Track scroll position
  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };

    handleScroll(); // Initial value
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Check screen size for responsive behavior
  useEffect(() => {
    const checkScreenSize = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);

      // Adjust grid layout based on screen size
      const gridContainer = document.getElementById('report-grid-container');
      const reportContent = document.getElementById('report-content');
      const rightColumn = document.getElementById('right-column');

      if (gridContainer && reportContent) {
        if (mobile) {
          // Mobile: single column layout
          gridContainer.style.gridTemplateColumns = '1fr';
          gridContainer.style.gap = '0';
          reportContent.style.paddingTop = '0';
          reportContent.style.width = '100%';
          if (rightColumn) rightColumn.style.display = 'none';
        } else {
          // Desktop: three columns with percentages
          gridContainer.style.gridTemplateColumns = '15% 1fr 15%';
          gridContainer.style.gap = '20px';
          reportContent.style.paddingTop = '0';
          reportContent.style.width = '100%';
          if (rightColumn) rightColumn.style.display = 'block';
        }
      }
    };

    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);

    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // Calculate section positions and update on scroll/resize
  useEffect(() => {
    const updateSectionPositions = () => {
      const positions = new Map<string, { top: number; bottom: number }>();

      sections.forEach(section => {
        const element = document.getElementById(section.id);
        if (element) {
          const rect = element.getBoundingClientRect();
          const scrollTop = window.scrollY;
          positions.set(section.id, {
            top: rect.top + scrollTop,
            bottom: rect.bottom + scrollTop
          });
        }
      });

      setSectionPositions(positions);
    };

    // Initial calculation
    updateSectionPositions();

    // Update on scroll and resize
    window.addEventListener('scroll', updateSectionPositions);
    window.addEventListener('resize', updateSectionPositions);

    // Also update when content changes (for dynamic loading)
    const observer = new MutationObserver(updateSectionPositions);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener('scroll', updateSectionPositions);
      window.removeEventListener('resize', updateSectionPositions);
      observer.disconnect();
    };
  }, []);

  // Determine active section based on scroll position
  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + window.innerHeight / 3;

      for (const section of sections) {
        const position = sectionPositions.get(section.id);
        if (position && scrollPosition >= position.top && scrollPosition < position.bottom) {
          setActiveSection(section.id);
          return;
        }
      }
    };

    handleScroll(); // Initial check
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [sectionPositions]);

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      const yOffset = -20; // Small offset from top
      const y = element.getBoundingClientRect().top + window.scrollY + yOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  };

  const getSectionTopPosition = (sectionId: string): number => {
    const position = sectionPositions.get(sectionId);
    if (!position) return 0;

    // Calculate relative position to viewport
    const scrollTop = window.scrollY;
    const viewportHeight = window.innerHeight;
    const sectionMiddle = (position.top + position.bottom) / 2;

    // Position relative to timeline container
    return sectionMiddle - scrollTop;
  };

  // Get the index of the active section
  const activeSectionIndex = sections.findIndex(s => s.id === activeSection);

  // Navigate to next/previous section
  const navigateToSection = (direction: 'prev' | 'next') => {
    const currentIndex = activeSectionIndex !== -1 ? activeSectionIndex : 0;
    let newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;

    // Wrap around
    if (newIndex < 0) newIndex = sections.length - 1;
    if (newIndex >= sections.length) newIndex = 0;

    scrollToSection(sections[newIndex].id);
  };

  // Mobile horizontal stepper - fixed at top when scrolling past header
  if (isMobile) {
    // Calculate header height (approximately 80-100px on mobile)
    const headerHeight = 80;
    const isScrolledPastHeader = scrollY > 20;

    const mobileNav = (
      <div
        style={{
          position: 'fixed',
          top: isScrolledPastHeader ? '0' : `${headerHeight}px`,
          left: 0,
          right: 0,
          width: '100vw',
          backgroundColor: 'var(--background-primary, #fff)',
          borderBottom: '2px solid var(--primary-color, #007bff)',
          padding: '12px 16px',
          zIndex: 1000,
          boxShadow: '0 2px 8px var(--shadow-light, rgba(0,0,0,0.1))',
          transition: 'top 0.2s ease'
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px'
        }}>
          {/* Previous button */}
          <button
            onClick={() => navigateToSection('prev')}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              border: '1px solid var(--border-color, #ccc)',
              backgroundColor: 'var(--background-secondary, #f5f5f5)',
              color: 'var(--text-primary, #000)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              flexShrink: 0,
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--primary-color, #007bff)';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--background-secondary, #f5f5f5)';
              e.currentTarget.style.color = 'var(--text-primary, #000)';
            }}
          >
            ←
          </button>

          {/* Progress bar and section info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Section title */}
            <div style={{
              fontSize: '16px',
              fontWeight: '600',
              color: 'var(--text-primary, #000)',
              textAlign: 'center',
              marginBottom: '8px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {sections[activeSectionIndex !== -1 ? activeSectionIndex : 0].title}
            </div>

            {/* Progress dots */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}>
              {sections.map((section, index) => (
                <div
                  key={section.id}
                  onClick={() => scrollToSection(section.id)}
                  style={{
                    width: activeSection === section.id ? '24px' : '8px',
                    height: '8px',
                    borderRadius: '4px',
                    backgroundColor: activeSection === section.id
                      ? 'var(--primary-color, #007bff)'
                      : 'var(--border-color, #ccc)',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease'
                  }}
                />
              ))}
            </div>

            {/* Step counter */}
            <div style={{
              fontSize: '12px',
              color: 'var(--text-secondary, #666)',
              textAlign: 'center',
              marginTop: '6px'
            }}>
              {activeSectionIndex + 1} / {sections.length}
            </div>
          </div>

          {/* Next button */}
          <button
            onClick={() => navigateToSection('next')}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              border: '1px solid var(--border-color, #ccc)',
              backgroundColor: 'var(--background-secondary, #f5f5f5)',
              color: 'var(--text-primary, #000)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              flexShrink: 0,
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--primary-color, #007bff)';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--background-secondary, #f5f5f5)';
              e.currentTarget.style.color = 'var(--text-primary, #000)';
            }}
          >
            →
          </button>
        </div>
      </div>
    );

    return mobileNav;
  }

  // Desktop vertical timeline
  return (
    <div
      ref={timelineRef}
      style={{
        position: 'fixed',
        left: '20px',
        top: '100px',
        bottom: '100px',
        width: 'calc(15% - 40px)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-around',
        pointerEvents: 'none',
        zIndex: 50
      }}
    >
      {/* Vertical line */}
      <div
        style={{
          position: 'absolute',
          left: '0',
          top: '0',
          bottom: '0',
          width: '2px',
          background: 'linear-gradient(to bottom, transparent, var(--primary-color, #007bff) 10%, var(--primary-color, #007bff) 90%, transparent)',
          opacity: 0.3
        }}
      />

      {/* Section items */}
      {sections.map((section, index) => {
        const isActive = activeSection === section.id;
        const percentagePosition = (index / (sections.length - 1)) * 100;

        return (
          <div
            key={section.id}
            style={{
              position: 'absolute',
              left: '0',
              top: `${percentagePosition}%`,
              transform: 'translateY(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              pointerEvents: 'auto',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onClick={() => scrollToSection(section.id)}
          >
            {/* Connection point */}
            <div
              style={{
                width: isActive ? '12px' : '8px',
                height: isActive ? '12px' : '8px',
                borderRadius: '50%',
                backgroundColor: isActive ? 'var(--primary-color, #007bff)' : 'var(--border-color, #ccc)',
                border: isActive ? '2px solid var(--background-primary, #fff)' : 'none',
                boxShadow: isActive ? '0 0 8px var(--primary-color, #007bff)' : 'none',
                transition: 'all 0.3s ease',
                flexShrink: 0,
                marginLeft: isActive ? '-2px' : '0'
              }}
            />

            {/* Section label */}
            <div
              style={{
                fontSize: isActive ? '28px' : '13px',
                fontWeight: isActive ? '600' : '500',
                color: isActive ? 'var(--text-primary, #000)' : 'var(--text-secondary, #666)',
                whiteSpace: 'nowrap',
                transition: 'all 0.3s ease',
                opacity: isActive ? 1 : 0.7,
                textShadow: isActive ? '0 0 4px var(--background-primary, #fff)' : 'none'
              }}
            >
              {section.title}
            </div>
          </div>
        );
      })}
    </div>
  );
}
