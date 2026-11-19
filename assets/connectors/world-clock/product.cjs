/** Offline time-zone conversion for scheduling across offices. */
const name = 'cbim_connector_world_clock';
const tool = {
  name,
  description: 'Convert an ISO timestamp with an explicit UTC offset to local time in an IANA time zone.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['instant', 'timeZone'],
    properties: { instant: { type: 'string' }, timeZone: { type: 'string' } }
  }
};

exports.connectorProduct = {
  id: 'world-clock',
  version: '1.0.0',
  protocol: 1,
  Create() {
    return {
      mode: 'concurrent',
      async OpenSession() {
        let closed = false;
        function check(toolName) {
          if (closed || toolName !== name) throw Error('Unavailable clock tool');
        }
        return {
          List: () => closed ? [] : [tool],
          Describe(toolName) {
            check(toolName);
            return { effects: ['read'], native: false, contractVersion: 1 };
          },
          async Call(toolName, input, signal) {
            check(toolName);
            signal.throwIfAborted();
            if (typeof input?.instant !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(input.instant) || typeof input.timeZone !== 'string' || !input.timeZone)
              throw Error('Expected an ISO timestamp with offset and an IANA time zone');
            const formatter = new Intl.DateTimeFormat('en-GB', {
              timeZone: input.timeZone, dateStyle: 'full', timeStyle: 'long'
            });
            return { content: [{ type: 'text', text: formatter.format(new Date(input.instant)) }] };
          },
          async Release() { closed = true; }
        };
      }
    };
  }
};
