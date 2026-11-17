// On the timeline, an AgentToken grows on mouseover to AGENT_TOKEN_HOVER_SCALE times its size, by
// its width and height, so it's drawn sharp, from its center and in front of the other tokens, 
// then shrinks back.
import {test, expect} from '@playwright/test';
import {startGame, dismissAgentDossier} from './helpers.mjs';

const readToken = (page, agentId) => page.evaluate(agentId => {
    const token = tc.app.getTimelineView().tokensByAgentId[agentId],
        rect = token.getIDE().getBoundingClientRect(),
        ring = token.actionGauge;
    return {
        size:token.size, width:rect.width, height:rect.height,
        centerX:rect.left + rect.width / 2, centerY:rect.top + rect.height / 2,
        zIndex:+getComputedStyle(token.getIDE()).zIndex, ringWidth:ring.width, ringBorder:ring.borderWidth
    };
}, agentId);

test('an agent token grows from its center on mouseover, in front, and shrinks back', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {
        tc.model.revealAgents(['BR']);
        tc.model.getAgentModel('BR').setEvent('origin');
    });
    await dismissAgentDossier(page, 'Bravo');
    await expect.poll(() => page.evaluate(() => !!tc.app.getTimelineView().tokensByAgentId.BR)).toBe(true);
    await page.waitForTimeout(800); // Let the layout settle.
    
    const before = await readToken(page, 'AL'),
        base = before.size;
    expect(before.zIndex).toBe(3);
    
    await page.mouse.move(before.centerX, before.centerY);
    await expect.poll(() => readToken(page, 'AL').then(token => token.size)).toBe(4 * base);
    const grown = await readToken(page, 'AL');
    expect(grown.width).toBeCloseTo(4 * base, 0);
    expect(grown.height).toBeCloseTo(4 * base, 0);
    expect(grown.centerX).toBeCloseTo(before.centerX, 0);
    expect(grown.centerY).toBeCloseTo(before.centerY, 0);
    // In front of Bravo, and its rings grown with it.
    expect(grown.zIndex).toBeGreaterThan((await readToken(page, 'BR')).zIndex);
    expect(grown.ringWidth).toBeCloseTo(4 * before.ringWidth, 0);
    expect(grown.ringBorder).toBeCloseTo(4 * before.ringBorder, 0);
    
    await page.mouse.move(0, 0);
    await expect.poll(() => readToken(page, 'AL')).toEqual(before);
    
    expect(problems.pageErrors).toEqual([]);
});
