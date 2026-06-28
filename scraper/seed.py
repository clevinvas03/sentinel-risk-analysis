"""Cold-start knowledge base.

Seeds the KB with substantive, general domain reference notes so the agent has
internal material to retrieve on first run — even with no network access to the
live scrapers. These are framed as analyst reference notes (established domain
principles), not as specific statistics attributed to real sources, so the agent
can cite them honestly as internal knowledge-base material.

Usage:
    python seed.py
"""

from __future__ import annotations

from chunking import chunk_text, word_count
from db import connect
from embeddings import embed

# Each entry becomes a `documents` row (source="seed") and is chunked + embedded.
SEED_DOCS: list[dict] = [
    {
        "title": "Flood risk for data centre siting — reference note",
        "country": None,
        "text": (
            "Flood exposure is one of the most consequential physical risks in data "
            "centre site selection because water ingress damages power and cooling "
            "plant and can cause total loss of availability. Site screening normally "
            "starts with fluvial (river) and pluvial (surface-water) flood maps, plus "
            "coastal storm-surge zones for waterfront sites. A common standard is to "
            "avoid the 1-in-100-year (1% annual exceedance probability) floodplain for "
            "critical plant, and to elevate electrical rooms and generators above the "
            "1-in-500-year level where feasible.\n\n"
            "Beyond the static maps, reviewers consider upstream dam and levee "
            "condition, local drainage capacity, and the trend in extreme-precipitation "
            "intensity under climate change, which is increasing pluvial risk in many "
            "regions even where river flooding is controlled. Mitigations include site "
            "grading and bunding, raised plinths, flood barriers and doors, sump pumps "
            "with independent power, and locating generators and fuel above flood level. "
            "Insurance availability and cost are a useful market signal: hard-to-insure "
            "sites usually carry real residual flood risk."
        ),
    },
    {
        "title": "Seismic risk and data centre resilience — reference note",
        "country": None,
        "text": (
            "Seismic hazard matters for data centres in tectonically active regions "
            "such as Japan, the US West Coast, Italy, Turkey, Chile, New Zealand and "
            "parts of the eastern Mediterranean. Hazard is characterised by peak ground "
            "acceleration (PGA) at defined return periods and by proximity to mapped "
            "faults and soft or liquefiable soils, which amplify shaking. Naples and the "
            "wider Campania region of southern Italy, for example, sit in a "
            "moderate-to-high seismic zone influenced by the Apennine fault system and "
            "by volcanic ground near Vesuvius and the Campi Flegrei caldera.\n\n"
            "Resilient design uses seismic anchoring and bracing for racks, "
            "transformers, switchgear and pipework; base isolation or snubbers for "
            "sensitive plant; and flexible connections on water, fuel and power lines so "
            "movement does not shear them. Battery and generator rooms need particular "
            "attention because post-quake power loss is the dominant availability "
            "failure mode. Most operators design critical facilities to a higher "
            "importance factor than ordinary buildings under local seismic code."
        ),
    },
    {
        "title": "Grid capacity, power and interconnection risk — reference note",
        "country": None,
        "text": (
            "Access to firm, affordable power has become the single biggest constraint "
            "on hyperscale data centre development. The key risks are interconnection "
            "queue length (years in many markets), available substation and transmission "
            "headroom, grid frequency and voltage stability, and the carbon intensity "
            "and price volatility of the local generation mix. Markets such as Northern "
            "Virginia, Dublin, Frankfurt, Amsterdam and Singapore have all hit periods "
            "of grid or moratorium-driven constraint.\n\n"
            "Texas (ERCOT) is frequently cited for both opportunity and risk: abundant "
            "wind, solar and gas and a fast interconnection process, but an islanded grid "
            "with limited ties to neighbours, exposure to extreme heat and winter "
            "events, and scarcity-priced energy that can spike sharply. Operators "
            "mitigate grid risk with on-site or contracted generation, battery storage, "
            "demand-response participation, dual feeds from separate substations, and "
            "power-purchase agreements that hedge both price and carbon."
        ),
    },
    {
        "title": "Climate change and long-term physical risk — reference note",
        "country": None,
        "text": (
            "Climate change reshapes data centre risk over the multi-decade asset life. "
            "Rising mean and extreme temperatures raise cooling load and reduce free-"
            "cooling hours, cutting efficiency (worsening PUE) and stressing chillers on "
            "the hottest days. More intense rainfall increases pluvial flood risk; sea-"
            "level rise and stronger storms increase coastal exposure; prolonged drought "
            "threatens water-cooled sites that rely on evaporative cooling.\n\n"
            "Forward-looking siting uses downscaled climate projections (for example "
            "IPCC scenario pathways) to stress-test the design against mid-century "
            "conditions rather than the historical climate. Wildfire smoke is an "
            "emerging concern because particulates foul air-side economisers and "
            "filtration. Robust designs favour water-efficient or air-cooled approaches "
            "in water-stressed regions and oversize thermal headroom for future heat."
        ),
    },
    {
        "title": "Water and cooling constraints — reference note",
        "country": None,
        "text": (
            "Cooling strategy couples directly to water risk. Evaporative and adiabatic "
            "cooling are highly energy-efficient but consume large volumes of water, "
            "which is contentious in water-stressed basins and increasingly subject to "
            "permitting limits and community opposition. Water Usage Effectiveness (WUE) "
            "is the standard metric. Air-cooled and closed-loop systems use little or no "
            "water but typically trade off some energy efficiency.\n\n"
            "Liquid cooling — direct-to-chip and immersion — is rising rapidly with "
            "high-density AI compute, changing both the water and the power profile of a "
            "site. Site reviewers assess water-rights availability, drought frequency, "
            "discharge permitting for blowdown, and the regulatory trajectory, since "
            "several jurisdictions have begun restricting potable-water cooling for new "
            "data centres."
        ),
    },
    {
        "title": "Planning, permitting and jurisdiction risk — reference note",
        "country": None,
        "text": (
            "Planning and permitting risk determines whether and when a site can be "
            "built. It spans land-use zoning, environmental impact assessment, grid "
            "connection consent, water abstraction and discharge permits, noise limits "
            "(from chillers and generators), backup-generator air permits, and local "
            "political sentiment. Some jurisdictions have imposed explicit data centre "
            "moratoria or energy-efficiency conditions; Dublin and parts of the "
            "Netherlands and Singapore are well-known examples of constraint.\n\n"
            "Jurisdiction risk also covers the stability and predictability of the legal "
            "regime, the speed and transparency of approvals, and the risk of "
            "retroactive policy change. Experienced developers weight time-to-power and "
            "time-to-permit as heavily as raw land cost, because a cheap site that "
            "cannot be energised or consented for years has little value."
        ),
    },
    {
        "title": "Geopolitical, jurisdiction and data-sovereignty risk — reference note",
        "country": None,
        "text": (
            "Geopolitical risk for data centres includes data-sovereignty and residency "
            "law (which can mandate in-country storage), export controls on advanced "
            "compute hardware, sanctions exposure, the risk of state interference or "
            "lawful-access demands, submarine-cable and energy-supply chokepoints, and "
            "broader political stability. The EU (GDPR and sovereignty initiatives), "
            "China, India and a growing list of states impose localisation or access "
            "requirements that shape where regulated workloads may run.\n\n"
            "Operators favour stable jurisdictions with clear rule of law, strong "
            "treaty networks, and resilient, diverse connectivity. Concentration risk — "
            "too much capacity in one country or one cable landing region — is itself a "
            "geopolitical exposure, which is part of why hyperscalers spread regions and "
            "availability zones across legal jurisdictions."
        ),
    },
    {
        "title": "Connectivity, latency and submarine-cable risk — reference note",
        "country": None,
        "text": (
            "Network connectivity and latency drive both performance and resilience. "
            "Key factors are the number of diverse fibre routes into a site, proximity "
            "to internet exchanges and major metros, carrier and dark-fibre "
            "availability, and for international traffic the diversity and landing points "
            "of submarine cables. Latency-sensitive workloads (trading, real-time "
            "interaction, some AI inference) require placement close to users or "
            "exchange points.\n\n"
            "Cable-related risk is concentrated at landing stations and chokepoints such "
            "as the Red Sea, the Luzon Strait and the Strait of Malacca, where a small "
            "number of cables carry disproportionate traffic and are exposed to anchor "
            "damage, sabotage or geopolitical disruption. Route and landing diversity is "
            "the primary mitigation."
        ),
    },
    {
        "title": "Cost, supply chain and labour risk — reference note",
        "country": None,
        "text": (
            "Total cost of ownership for a data centre is dominated by power price and "
            "availability, land, construction, and the long-lead equipment supply chain. "
            "Generators, large transformers, switchgear, chillers and increasingly "
            "GPUs/accelerators have all seen multi-quarter to multi-year lead times, "
            "making supply-chain risk a scheduling and cost risk at once. Concentration "
            "of key components in a few manufacturers or regions adds fragility.\n\n"
            "Labour risk covers the availability of skilled construction trades during "
            "build and of qualified operations and electrical staff during the asset "
            "life; tight local labour markets raise cost and slow delivery. Cost "
            "screening therefore looks past headline land and power prices to lead "
            "times, local construction-market heat, tax and incentive regimes, and the "
            "depth of the local skilled-labour pool."
        ),
    },
    {
        "title": "Comparing hyperscale markets: Ireland vs Denmark — reference note",
        "country": None,
        "text": (
            "Ireland (notably Dublin) became a leading European hub thanks to climate, "
            "connectivity, tax regime and an established cluster, but it now faces "
            "significant grid constraint: the system operator has at times effectively "
            "paused new Dublin-area connections, and data centres consume a large and "
            "politically sensitive share of national electricity. New Irish projects "
            "increasingly require on-site generation or flexible-demand commitments.\n\n"
            "Denmark offers a cool climate well-suited to free cooling, a high share of "
            "wind generation supporting low-carbon operation, strong governance and "
            "connectivity, and active hyperscale investment. Trade-offs include grid "
            "headroom in specific locations, heat-reuse expectations (district-heating "
            "integration is encouraged), and exposure to wind-driven price variability. "
            "For a new hyperscale build the decision usually turns on time-to-power, "
            "carbon profile and local grid headroom rather than climate alone, and "
            "Denmark frequently scores well on the first two."
        ),
    },
]


def main() -> None:
    conn = connect()
    total = 0
    try:
        for i, doc in enumerate(SEED_DOCS):
            # Stable synthetic URL so re-running seed upserts instead of duplicating.
            url = f"seed://reference/{i}-{doc['title'][:40].replace(' ', '-').lower()}"
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO documents (source, url, title, country, published_at, raw_text)
                    VALUES ('seed', %s, %s, %s, NULL, %s)
                    ON CONFLICT (url) DO UPDATE
                      SET title = EXCLUDED.title, raw_text = EXCLUDED.raw_text, fetched_at = now()
                    RETURNING id
                    """,
                    (url, doc["title"], doc.get("country"), doc["text"]),
                )
                doc_id = cur.fetchone()[0]
                cur.execute("DELETE FROM chunks WHERE document_id = %s", (doc_id,))

            chunks = chunk_text(doc["text"])
            vectors = embed(chunks)
            with conn.cursor() as cur:
                for j, (chunk, vec) in enumerate(zip(chunks, vectors)):
                    cur.execute(
                        """
                        INSERT INTO chunks (document_id, chunk_index, text, token_count, embedding)
                        VALUES (%s, %s, %s, %s, %s)
                        """,
                        (doc_id, j, chunk, word_count(chunk), vec),
                    )
            conn.commit()
            total += len(chunks)
            print(f"  seeded: {doc['title']} ({len(chunks)} chunks)")
        print(f"\nSeed complete. {len(SEED_DOCS)} documents, {total} chunks.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
