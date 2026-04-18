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
    'Swap':        { bg: 'rgba(10,126,106,0.12)',  color: '#065C4E', border: 'rgba(10,126,106,0.35)' },
    'Acquisition': { bg: 'rgba(22,89,168,0.12)',   color: '#0C447C', border: 'rgba(22,89,168,0.35)' },
    'Divestment':  { bg: 'rgba(154,98,0,0.12)',    color: '#7A4E00', border: 'rgba(154,98,0,0.35)' },
    'Partnership': { bg: 'rgba(92,63,160,0.12)',   color: '#3C3489', border: 'rgba(92,63,160,0.35)' },
};

const STAGE_COLORS = {
    'New Idea':   { bg: 'rgba(90,88,82,0.12)',   color: '#444441', border: 'rgba(90,88,82,0.35)' },
    'Screening':  { bg: 'rgba(22,89,168,0.12)',   color: '#0C447C', border: 'rgba(22,89,168,0.35)' },
    'Assessment': { bg: 'rgba(154,98,0,0.12)',    color: '#7A4E00', border: 'rgba(154,98,0,0.35)' },
    'DGA':        { bg: 'rgba(10,126,106,0.12)',  color: '#065C4E', border: 'rgba(10,126,106,0.35)' },
    'Project':    { bg: 'rgba(10,126,106,0.12)',  color: '#065C4E', border: 'rgba(10,126,106,0.35)' },
};

// ── LLM options ──────────────────────────────────────────────────────────────
const LLM_OPTIONS = [
    { label: 'Claude Sonnet 4.6',  value: 'sfdc_ai__DefaultBedrockAnthropicClaude46Sonnet' },
    { label: 'GPT 5.2',            value: 'sfdc_ai__DefaultGPT52' },
    { label: 'GPT 5.1',            value: 'sfdc_ai__DefaultGPT51' },
    { label: 'Gemini 2.5 Pro',     value: 'sfdc_ai__DefaultVertexAIGeminiPro25' },
];

const DEFAULT_LLM = 'sfdc_ai__DefaultBedrockAnthropicClaude46Sonnet';

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
    @track selectedLlm          = DEFAULT_LLM;
    @track currentDigestStatus  = '';

    // ── LLM options for the modal dropdown ──────────────────────────────────
    get llmOptions() {
        return LLM_OPTIONS;
    }

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
    get canPublish() {
        return this.isAdmin && this.currentDigestStatus === 'Ready';
    }

    get isStatusReady() {
        return this.currentDigestStatus === 'Ready';
    }

    // ── Labels ───────────────────────────────────────────────────────────────
    get rerunLabel()   { return this.isRunning ? 'Generating...' : 'Re-run AI analysis'; }
    get statusLabel()  { return this.digest?.meta?.status || 'Ready'; }
    get modelUsed()    { return this.digest?.meta?.llm_used || 'Claude Sonnet 4.6'; }
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
        if (d.funnel_projects) {
            d.funnel_projects = d.funnel_projects.map(proj => {
                const sc = STAGE_COLORS[proj.stage] || STAGE_COLORS['Screening'];
                return {
                    ...proj,
                    stagePillStyle: `background:${sc.bg}; color:${sc.color}; border-color:${sc.border}`
                };
            });
        }
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

    handleRerun() {
        this.adminFeedback = '';
        this.selectedLlm   = DEFAULT_LLM;
        this.showModal     = true;
    }

    handleFeedbackChange(evt) {
        this.adminFeedback = evt.target.value;
    }

    handleLlmChange(evt) {
        this.selectedLlm = evt.target.value;
    }

    handleModalConfirm() {
        this.showModal = false;
        this.isRunning = true;

        triggerNewDigest({ feedback: this.adminFeedback, llmUsed: this.selectedLlm })
            .then(() => {
                this.dispatchEvent(new ShowToastEvent({
                    title:   'AI analysis queued',
                    message: 'A new digest is being generated. Refresh in a few minutes.',
                    variant: 'success',
                    mode:    'sticky'
                }));
                this.isRunning     = false;
                this.adminFeedback = '';
                this.selectedLlm   = DEFAULT_LLM;
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

    stopPropagation(evt) {
        evt.stopPropagation();
    }

    handleModalCancel() {
        this.showModal     = false;
        this.adminFeedback = '';
        this.selectedLlm   = DEFAULT_LLM;
    }

    // ── Event handlers — Publish ─────────────────────────────────────────────

    handlePublish() {
        publishDigest({ digestId: this.selectedDigestId })
            .then(() => {
                this.currentDigestStatus = 'Published';

                if (this.digest && this.digest.meta) {
                    this.digest = {
                        ...this.digest,
                        meta: { ...this.digest.meta, status: 'Published' }
                    };
                }

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