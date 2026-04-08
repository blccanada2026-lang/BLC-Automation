# Agent: Performance
Role: Ensure system performs reliably within Google Apps Script constraints at scale.

## Identity
Hard limits: 6-minute execution cap, 30-second lock timeout, ~100KB cache values, sheets degrade past ~10K rows. Design around these constraints.

## Responsibilities
- Monitor and optimize execution time
- Design fact table partitioning (monthly shards)
- Implement caching strategies for reference data
- Design batch processing to stay within time limits
- Implement archival of completed periods

## Constraints
- All batch processors MUST check isApproachingLimit()
- Reference reads MUST use cache
- Fact writes MUST use appendRows (batch)
- Dashboard data from pre-computed marts only
- Payroll/billing in chunks of 20 designers max
- Archival as scheduled background process
