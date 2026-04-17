import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import isCurrentUserAdmin  from '@salesforce/apex/CFOBDCanvasController.isCurrentUserAdmin';
import getDigestDates      from '@salesforce/apex/CFOBDCanvasController.getDigestDates';
import getDigestById       from '@salesforce/apex/CFOBDCanvasController.getDigestById';
import triggerNewDigest    from '@salesforce/apex/CFOBDCanvasController.triggerNewDigest';
import publishDigest       from '@salesforce/apex/CFOBDCanvasController.publishDigest';

// ── Region colour map ────────────────────────────────────────────────────────
const REGION_COLORS = {
    'Europe':                { dot: '#1D9E75', header: 'linear-gradient(135deg,#0a3d2e 0%,#0f5a40 100%)' },
    'North America':         { dot: '#378ADD', header: 'linear-gradient(135deg,#0d2a4a 0%,#1a4a7a 100%)' },
    'South America':         { dot: '#EF9F27', header: 'linear-gradient(135deg,#3d2a00 0%,#6b4a00 100%)' },
    'Africa & ME':           { dot: '#D85A30', header: 'linear-gradient(135deg,#3d1500 0%,#6b2a00 100%)' },
    'Asia':                  { dot: '#D4537E', header: 'linear-gradient(135deg,#3d0020 0%,#6b0038 100%)' },
    'Power':                 { dot: '#7F77DD', header: 'linear-gradient(135deg,#1a1040 0%,#2d1d6b 100%)' },
    'Low Carbon Solutions':  { dot: '#5DCAA5', header: 'linear-gradient(135deg,#003d2e,#005a40 100%)' },
};

const DEAL_COLORS = {
    'Swap':        { bg: 'rgba(29,158,117,0.15)', color: '#5DCAA5', border: 'rgba(29,158,117,0.3)' },
    'Acquisition': { bg: 'rgba(55,138,221,0.15)', color: '#85B7EB', border: 'rgba(55,138,221,0.3)' },
    'Divestment':  { bg: 'rgba(239,159,39,0.15)',  color: '#FAC775', border: 'rgba(239,159,39,0.3)' },
    'Partnership': { bg: 'rgba(127,119,221,0.15)', color: '#AFA9EC', border: 'rgba(127,119,221,0.3)' },
};

const STAGE_COLORS = {
    'New Idea':   { bg: 'rgba(136,135,128,0.2)', color: '#B4B2A9' },
    'Screening':  { bg: 'rgba(55,138,221,0.15)', color: '#85B7EB' },
    'Assessment': { bg: 'rgba(239,159,39,0.15)',  color: '#FAC775' },
    'DGA':        { bg: 'rgba(29,158,117,0.2)',   color: '#5DCAA5' },
    'Project':    { bg: 'rgba(93,202,165,0.2)',   color: '#9FE1CB' },
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default class CfoBDCanvas extends LightningElement {

    @track digest               = null;
    @track digestDates          = [];
    @track selectedDigestId     = null;
    @track activeSection        = 'overview';
    @track isLoading            = true;
    @track hasError             = false;
    @track errorMessage         = '';
    @track isRunning            = false;

    // ── Admin + publish state ────────────────────────────────────────────────
    @track isAdmin              = false;
    @track showModal            = false;
    @track adminFeedback        = '';
    @track currentDigestStatus  = '';

    // ── Nav ink position ─────────────────────────────────────────────────────
    get inkStyle() {
        const sections = ['overview','intelligence','deals','pipeline','engagements'];
        const idx = sections.indexOf(this.activeSection);
        return `transform: translateX(${idx * 100}%); width: calc(100% / ${sections.length})`;
    }

    // ── Section active flags ─────────────────────────────────────────────────
    get isOverviewActive()     { return this.activeSection === 'overview'; }
    get isIntelligenceActive() { return this.activeSection === 'intelligence'; }
    get isDealsActive()        { return this.activeSection === 'deals'; }
    get isPipelineActive()     { return this.activeSection === 'pipeline'; }
    get isEngagementsActive()  { return this.activeSection === 'engagements'; }
    get isReady()              { return !this.isLoading && !this.hasError && this.digest !== null; }

    // ── Admin-specific getters ────────────────────────────────────────────────
    /** True when the current digest is Ready and the user is Admin — shows Publish button. */
    get canPublish() {
        return this.isAdmin && this.currentDigestStatus === 'Ready';
    }

    /** True when status is Ready — drives amber badge variant in the header. */
    get isStatusReady() {
        return this.currentDigestStatus === 'Ready';
    }

    // ── Labels ───────────────────────────────────────────────────────────────
    get rerunLabel()   { return this.isRunning ? 'Generating...' : 'Re-run AI analysis'; }
    get statusLabel()  { return this.digest?.meta?.status || 'Ready'; }
    get intelCount()   { return (this.digest?.key_intelligence || []).length; }
    get dgaCount()     { return (this.digest?.dga_outlook || []).length; }
    get funnelCount()  { return (this.digest?.funnel_projects || []).length; }
    get currentWeekCount() { return (this.digest?.external_engagements?.current_week || []).length; }
    get comingWeekCount()  { return (this.digest?.external_engagements?.coming_week || []).length; }

    // ── Funnel stage summary for overview bars ───────────────────────────────
    get funnelStages() {
        const stageOrder = ['New Idea', 'Screening', 'Assessment', 'DGA'];
        const projects = this.digest?.funnel_projects || [];
        const max = Math.max(1, projects.length);
        return stageOrder.map(label => {
            const count = projects.filter(p => p.stage === label).length;
            const pct = Math.round((count / max) * 100);
            const col = STAGE_COLORS[label] || STAGE_COLORS['Screening'];
            return {
                label,
                count,
                barStyle: `width:${pct}%; background:${col.color}; opacity:0.8`
            };
        });
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────
    connectedCallback() {
        // Check admin status in parallel with loading dates
        isCurrentUserAdmin()
            .then(result => { this.isAdmin = result; })
            .catch(() => { this.isAdmin = false; });

        this.loadDigestDates();
    }

    // ── Data loading ─────────────────────────────────────────────────────────
    loadDigestDates() {
        this.isLoading = true;
        getDigestDates()
            .then(result => {
                if (!result || result.length === 0) {
                    this.hasError = true;
                    this.errorMessage = 'No published digests found. Run the scheduler to generate the first digest.';
                    this.isLoading = false;
                    return;
                }
                this.digestDates = result.map((d, i) => ({
                    id:         d.id,
                    label:      d.label,
                    status:     d.status,
                    isSelected: i === 0
                }));
                this.selectedDigestId = result[0].id;
                this.loadDigest(this.selectedDigestId);
            })
            .catch(err => {
                this.hasError = true;
                this.errorMessage = err.body?.message || 'Failed to load digest list.';
                this.isLoading = false;
            });
    }

    loadDigest(digestId) {
        this.isLoading = true;
        this.hasError  = false;
        getDigestById({ digestId })
            .then(result => {
                const raw = JSON.parse(result);
                this.digest = this.enrichDigest(raw.digest);
                // Keep currentDigestStatus in sync so canPublish getter is accurate
                this.currentDigestStatus = this.digest?.meta?.status || '';
                this.isLoading = false;
            })
            .catch(err => {
                this.hasError     = true;
                this.errorMessage = err.body?.message || 'Failed to load digest.';
                this.isLoading    = false;
            });
    }

    // ── Enrich digest with computed style properties ─────────────────────────
    enrichDigest(d) {
        // Key intelligence
        if (d.key_intelligence) {
            d.key_intelligence = d.key_intelligence.map(item => {
                const rc = REGION_COLORS[item.region] || { dot: '#888', header: 'linear-gradient(135deg,#1a1a1a,#2a2a2a)' };
                const dc = this.dealColor(item.deal_type);
                return {
                    ...item,
                    regionDotStyle: `background:${rc.dot}`,
                    headerStyle:    `background:${rc.header}`,
                    dealTagStyle:   `background:${dc.bg}; color:${dc.color}; border-color:${dc.border}`
                };
            });
        }
        // Funnel projects
        if (d.funnel_projects) {
            d.funnel_projects = d.funnel_projects.map(proj => {
                const sc = STAGE_COLORS[proj.stage] || STAGE_COLORS['Screening'];
                return {
                    ...proj,
                    stagePillStyle: `background:${sc.bg}; color:${sc.color}`
                };
            });
        }
        // Engagements — parse dates
        ['current_week','coming_week'].forEach(week => {
            if (d.external_engagements?.[week]) {
                d.external_engagements[week] = d.external_engagements[week].map(eng => {
                    const dt = new Date(eng.date);
                    return {
                        ...eng,
                        dayLabel:      dt.getDate(),
                        monthLabel:    MONTHS[dt.getMonth()],
                        contactsLabel: eng.contacts?.length > 0 ? eng.contacts.join(', ') : 'No contacts logged'
                    };
                });
            }
        });
        return d;
    }

    dealColor(type) {
        const key = Object.keys(DEAL_COLORS).find(k => type?.includes(k));
        return key ? DEAL_COLORS[key] : { bg:'rgba(136,135,128,0.15)', color:'#B4B2A9', border:'rgba(136,135,128,0.3)' };
    }

    // ── Event handlers — navigation ──────────────────────────────────────────
    handleNavClick(evt) {
        this.activeSection = evt.currentTarget.dataset.section;
    }

    handleDateChange(evt) {
        this.selectedDigestId = evt.target.value;
        this.digestDates = this.digestDates.map(d => ({
            ...d,
            isSelected: d.id === this.selectedDigestId
        }));
        this.loadDigest(this.selectedDigestId);
    }

    handleIntelClick(evt) {
        this.activeSection = 'intelligence';
    }

    // ── Event handlers — Re-run (admin modal) ────────────────────────────────

    /** Opens the feedback modal instead of firing immediately. */
    handleRerun() {
        this.adminFeedback = '';
        this.showModal     = true;
    }

    /** Keeps adminFeedback in sync as the admin types. */
    handleFeedbackChange(evt) {
        this.adminFeedback = evt.target.value;
    }

    /** Admin confirms the re-run — fires the job with optional feedback. */
    handleModalConfirm() {
        this.showModal = false;
        this.isRunning = true;

        triggerNewDigest({ feedback: this.adminFeedback })
            .then(() => {
                this.dispatchEvent(new ShowToastEvent({
                    title:   'AI analysis queued',
                    message: 'A new digest is being generated. Refresh in a few minutes.',
                    variant: 'success',
                    mode:    'sticky'
                }));
                this.isRunning     = false;
                this.adminFeedback = '';
                // Reload the date list after a short delay so the Running digest appears
                setTimeout(() => this.loadDigestDates(), 5000);
            })
            .catch(err => {
                this.dispatchEvent(new ShowToastEvent({
                    title:   'Failed to queue digest',
                    message: err.body?.message || 'Unknown error',
                    variant: 'error'
                }));
                this.isRunning = false;
            });
    }

    /** Admin cancels — close modal, clear feedback. */
    /** Prevents clicks inside the card from bubbling to the overlay. */
    stopPropagation(evt) {
        evt.stopPropagation();
    }

    handleModalCancel() {
        this.showModal     = false;
        this.adminFeedback = '';
    }

    // ── Event handlers — Publish ─────────────────────────────────────────────

    /** Flips the current digest from Ready to Published. */
    handlePublish() {
        publishDigest({ digestId: this.selectedDigestId })
            .then(() => {
                // ── Optimistic UI update — no reload needed ────────────
                // 1. Flip the status driving the badge and canPublish getter
                this.currentDigestStatus = 'Published';

                // 2. Also update digest.meta.status so statusLabel stays in sync
                if (this.digest && this.digest.meta) {
                    this.digest = {
                        ...this.digest,
                        meta: { ...this.digest.meta, status: 'Published' }
                    };
                }

                // 3. Strip "· Awaiting Review" from the selected date picker option
                //    Regex handles any spacing variation around the separator
                this.digestDates = this.digestDates.map(d => {
                    if (d.id === this.selectedDigestId) {
                        return {
                            ...d,
                            status: 'Published',
                            label:  d.label.replace(/\s*·\s*Awaiting Review\s*$/i, '')
                        };
                    }
                    return d;
                });

                this.dispatchEvent(new ShowToastEvent({
                    title:   'Digest published',
                    message: 'The digest is now visible to all users.',
                    variant: 'success',
                    mode:    'sticky'
                }));
            })
            .catch(err => {
                this.dispatchEvent(new ShowToastEvent({
                    title:   'Publish failed',
                    message: err.body?.message || 'Unknown error',
                    variant: 'error'
                }));
            });
    }
}