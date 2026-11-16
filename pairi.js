// Tile indices: 0–8 man, 9–17 pin, 18–26 sou, 27–33 honors.
export function tileIndex(tile) {
    if (tile >= 51) tile = (tile - 50)*10 + 5
    return tile < 40 ? (Math.floor(tile/10)-1)*9 + tile%10-1 : tile-14
}

export function tileNumber(index) {
    return index < 27 ? (Math.floor(index/9)+1)*10 + index%9+1 : index+14
}

// Minimum missing tiles for every possible number of sets and pair in a suit.
// Enumerating complete target shapes also prevents waiting for a fifth copy
// of a tile already used in a triplet or fixed meld.
function suitCosts(hand, limits, maxSets) {
    const shapes = hand.map((_, i) => [i, i, i])
    if (hand.length == 9) {
        for (let i=0; i<7; i++) shapes.push([i, i+1, i+2])
    }
    const target = hand.map(() => 0)
    const costs = Array.from({length: maxSets+1}, () => [Infinity, Infinity])
    function search(start, sets, cost) {
        costs[sets][0] = Math.min(costs[sets][0], cost)
        for (let i=0; i<hand.length; i++) {
            if (target[i]+2 > limits[i]) continue
            const extra = Math.max(0, target[i]+2-hand[i]) - Math.max(0, target[i]-hand[i])
            costs[sets][1] = Math.min(costs[sets][1], cost+extra)
        }
        if (sets == maxSets) return
        for (let i=start; i<shapes.length; i++) {
            const tiles = shapes[i]
            const copies = tiles[0] == tiles[1] ? 3 : 1
            if (tiles.some(t => target[t]+copies > limits[t])) continue
            let extra = 0
            for (const t of tiles) {
                target[t]++
                if (target[t] > hand[t]) extra++
            }
            search(i, sets+1, cost+extra)
            for (const t of tiles) target[t]--
        }
    }
    search(0, 0, 0)
    return costs
}

function calculator(melds) {
    const fixed = Array(34).fill(0)
    for (const meld of melds) for (const tile of meld) fixed[tile]++
    const maxSets = 4-melds.length
    const cache = new Map()
    return hand => {
        let dp = Array.from({length: maxSets+1}, () => [Infinity, Infinity])
        dp[0][0] = 0
        for (let suit=0; suit<4; suit++) {
            const start = suit*9
            const counts = hand.slice(start, start+9)
            const limits = fixed.slice(start, start+9).map(n => 4-n)
            const key = counts.join('') + ':' + limits.join('')
            if (!cache.has(key)) cache.set(key, suitCosts(counts, limits, maxSets))
            const costs = cache.get(key)
            const next = Array.from({length: maxSets+1}, () => [Infinity, Infinity])
            for (let sets=0; sets<=maxSets; sets++) {
                for (let added=0; added+sets<=maxSets; added++) {
                    for (let pair=0; pair<=1; pair++) {
                        for (let head=0; head+pair<=1; head++) {
                            next[sets+added][pair+head] = Math.min(next[sets+added][pair+head], dp[sets][pair]+costs[added][head])
                        }
                    }
                }
            }
            dp = next
        }
        let shanten = dp[maxSets][1]-1
        if (!melds.length) {
            const pairs = hand.filter(n => n >= 2).length
            const kinds = hand.filter(n => n > 0).length
            const terminals = [0,8,9,17,18,26,27,28,29,30,31,32,33]
            const kokushiKinds = terminals.filter(t => hand[t] > 0).length
            const kokushiPair = terminals.some(t => hand[t] >= 2) ? 1 : 0
            shanten = Math.min(shanten, 6-pairs+Math.max(0, 7-kinds), 13-kokushiKinds-kokushiPair)
        }
        return shanten
    }
}

export function calculateShanten(tiles, melds = []) {
    const hand = Array(34).fill(0)
    for (const tile of tiles) hand[tile]++
    return calculator(melds)(hand)
}

export function analyzeDiscards(tiles, melds, remaining, discards) {
    const hand = Array(34).fill(0)
    const fixed = Array(34).fill(0)
    for (const tile of tiles) hand[tile]++
    for (const meld of melds) for (const tile of meld) fixed[tile]++
    const shanten = calculator(melds)
    function goodTenpai(draw) {
        for (let discard=0; discard<34; discard++) {
            if (!hand[discard]) continue
            hand[discard]--
            let waits = 0
            if (shanten(hand) == 0) {
                for (let tile=0; tile<34; tile++) {
                    // The hypothetical draw has left the unseen pool. The
                    // following discard stays visible, so never add it back.
                    const copies = remaining[tile] - (tile == draw ? 1 : 0)
                    if (copies <= 0 || hand[tile]+fixed[tile] >= 4) continue
                    hand[tile]++
                    if (shanten(hand) == -1) waits += copies
                    hand[tile]--
                    if (waits >= 5) break
                }
            }
            hand[discard]++
            if (waits >= 5) return true
        }
        return false
    }
    const results = []
    for (const tile of new Set(discards)) {
        hand[tile]--
        const after = shanten(hand)
        const effective = []
        for (let draw=0; draw<34; draw++) {
            if (remaining[draw] <= 0 || hand[draw]+fixed[draw] >= 4) continue
            hand[draw]++
            if (shanten(hand) < after) effective.push({tile: draw, count: remaining[draw], good: after == 1 && goodTenpai(draw)})
            hand[draw]--
        }
        results.push({tile, shanten: after, effective,
            kinds: effective.length, count: effective.reduce((n, t) => n+t.count, 0),
            good: effective.filter(t => t.good).reduce((n, t) => n+t.count, 0)})
        hand[tile]++
    }
    return results.sort((a, b) => a.shanten-b.shanten || b.count-a.count || b.kinds-a.kinds || a.tile-b.tile)
}

export function discardLosses(rows) {
    const best = rows[0].shanten
    const union = new Map()
    for (const row of rows.filter(row => row.shanten == best)) {
        for (const draw of row.effective) union.set(draw.tile, draw.count)
    }
    return rows.map(row => {
        const kept = new Set(row.effective.map(draw => draw.tile))
        const effective = [...union].filter(([tile]) => !kept.has(tile))
            .sort(([a], [b]) => a-b).map(([tile, count]) => ({tile, count}))
        return {...row, effective, count: effective.reduce((n, draw) => n+draw.count, 0)}
    })
}
