import { type Driver } from 'homey';
import GenericDriver from '../driver';

export = class extends GenericDriver {

  filterStrings = ['P110'];

  async onPair(session: Driver.PairSession): Promise<void> {
    session.setHandler('showView', async (viewId: string) => {
      if (viewId === 'ip_lookup') {
        const data = await session.emit('hello', 'Hello to you!');
        console.log({ data }); // Hi!
      }
    });
  }

}
