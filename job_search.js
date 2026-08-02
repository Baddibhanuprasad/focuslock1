const axios = require('axios');

class JobSearch {
  // Search Adzuna for jobs matching a goalText and location
  async searchJobs(goalText, location, appId, appKey) {
    try {
      if (!appId || !appKey) {
        return { jobs: [], error: { code: 'MISSING_KEYS', message: 'Adzuna app_id/app_key missing' } };
      }

      const country = 'in';
      const what = (goalText || '').trim();
      const where = (location || '').trim();

      const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1`;
      const params = {
        app_id: appId,
        app_key: appKey,
        what: what,
        where: where,
        results_per_page: 20,
        max_days_old: 30,
        sort_by: 'date'
      };

      // Optional category filter for tech-like goals
      const techKeywords = ['developer', 'engineer', 'frontend', 'backend', 'fullstack', 'devops', 'software', 'programmer', 'it', 'data'];
      const lc = what.toLowerCase();
      if (techKeywords.some(k => lc.includes(k))) {
        params.category = 'it-jobs';
      }

      const resp = await axios.get(url, { params, timeout: 10000 });
      const results = resp.data && resp.data.results ? resp.data.results : [];

      const jobsRaw = results.map(r => ({
        title: r.title || r.position || '',
        company: (r.company && r.company.display_name) || r.company || '',
        location: (r.location && r.location.display_name) || r.location || '',
        salaryMin: r.salary_min || r.salary_min || null,
        salaryMax: r.salary_max || r.salary_max || null,
        description: r.description || r.summary || '',
        applyUrl: r.redirect_url || r.url || r.redirect_url || '',
        postedDate: r.created || r.created_at || '',
        source: 'Adzuna'
      }));

      // Filter to fresher / internship / entry-level roles only
      const keywords = ['intern', 'internship', 'graduate', 'fresher', 'entry level', 'entry-level', 'junior', 'trainee', 'associate'];
      const jobs = jobsRaw.filter(j => {
        const text = `${j.title} ${j.description}`.toLowerCase();
        return keywords.some(k => text.includes(k));
      });

      // If jobs is empty, still return empty array (frontend will show external links)
      return { jobs, error: null };
    } catch (err) {
      const status = err.response ? err.response.status : null;
      const msg = err.response ? (err.response.data && err.response.data.error ? JSON.stringify(err.response.data.error) : err.response.data || err.message) : err.message;
      return { jobs: [], error: { code: status || 'NETWORK_ERROR', message: String(msg) } };
    }
  }

  buildExternalSearchUrls(goalText, location) {
    const goal = (goalText || '').trim();
    const loc = (location || '').trim();

    const linkedinUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(goal)}&location=${encodeURIComponent(loc)}&f_E=1,2`;

    // Naukri uses slug pattern: <goal-slug>-jobs-in-<location-slug>
    const slugify = (s) => {
      return (s || '').toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
    };
    const naukriUrl = `https://www.naukri.com/${slugify(goal)}-jobs-in-${slugify(loc)}`;

    return { linkedinUrl, naukriUrl };
  }
}

module.exports = new JobSearch();
