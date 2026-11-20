// Keep the scoring policy in sync with analyze_consensus.py. Display
// temperatures are intentionally independent of these fixed temperatures.
const temperatures = {Mortal: 1, Zenith: .35, Comet: .32, Miai: .73}

function modelName(evaluation) {
    const tag = `${evaluation.model_tag || ''} ${evaluation.name || ''}`.toLowerCase()
    if (tag.includes('mjai_41b')) return 'Mortal'
    return ['Zenith', 'Comet', 'Miai'].find(name => tag.includes(name.toLowerCase()))
}

function probabilities(evaluation, temperature) {
    const details = evaluation.details || []
    const index = evaluation.actual_index
    if (!Number.isInteger(index) || index < 0 || index >= details.length) return null
    const values = details.map(detail => detail.prob)
    if (values.some(p => typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1)) return null
    const maximum = Math.max(...values)
    if (!maximum) return null
    const weights = values.map(p => (p / maximum) ** (1 / temperature))
    return {probability: weights[index] / weights.reduce((a, b) => a + b, 0), support: weights[index]}
}

export function consensusMetrics(review) {
    const required = ['Mortal', 'Zenith', 'Comet']
    if (review.kyokus.some(kyoku => kyoku.entries.some(entry =>
        (entry.alt_engines || []).some(alt => modelName(alt) === 'Miai')))) required.push('Miai')
    const primary = {name: review.primary_engine_name || '', model_tag: review.model_tag || ''}
    function calculate(entries) {
        let loss = 0, sharedBad = 0, validDecisions = 0
        for (const entry of entries) {
            const models = new Map()
            for (const evaluation of [{...entry, ...primary}, ...(entry.alt_engines || [])]) {
                const name = modelName(evaluation)
                if (!required.includes(name)) continue
                // An ambiguous model must never silently contribute a score.
                if (models.has(name)) throw new Error(`同一决策存在多个 ${name} 模型，无法唯一选择`)
                models.set(name, probabilities(evaluation, temperatures[name]))
            }
            if (required.some(name => !models.get(name))) continue
            const support = Math.max(...required.map(name => models.get(name).support))
            loss += support > 0 ? Math.min(1, -Math.log(support) / Math.log(20)) : 1
            sharedBad += Number(required.every(name => models.get(name).probability < .05))
            validDecisions++
        }
        return {loss, sharedBad, validDecisions, totalDecisions: entries.length}
    }
    function finish(stats) {
        return {...stats, score: stats.validDecisions ? 100 * (1 - stats.loss / stats.validDecisions) : null,
            badRate: stats.validDecisions ? stats.sharedBad / stats.validDecisions : null}
    }
    const rounds = review.kyokus.map(kyoku => finish(calculate(kyoku.entries)))
    const total = rounds.reduce((total, round) => {
        for (const key of ['loss', 'sharedBad', 'validDecisions', 'totalDecisions']) total[key] += round[key]
        return total
    }, {loss: 0, sharedBad: 0, validDecisions: 0, totalDecisions: 0})
    return {models: required, rounds, total: finish(total)}
}
