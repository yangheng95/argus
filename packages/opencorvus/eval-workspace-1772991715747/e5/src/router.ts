export type Handler = (req: Request) => Response | Promise<Response>;

/**
 * Middleware 类型定义
 * 中间件接收请求和 next 函数，返回 Promise<Response>
 * 洋葱模型：中间件按注册顺序执行，先进后出（FIFO in, LIFO out）
 * 中间件可以短路：不调用 next 直接返回 Response
 */
export type Middleware = (req: Request, next: (req: Request) => Promise<Response>) => Promise<Response>;

interface Route {
  method: string;
  path: string;
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];
  private middlewares: Middleware[] = []; // 存储注册的中间件，按注册顺序排列

  get(path: string, handler: Handler): this {
    this.routes.push({ method: "GET", path, handler });
    return this;
  }

  post(path: string, handler: Handler): this {
    this.routes.push({ method: "POST", path, handler });
    return this;
  }

  /**
   * 注册中间件
   * @param middleware - 中间件函数
   * @returns this，支持链式调用
   */
  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * 处理请求
   * 1. 首先查找匹配的路由，找不到直接返回 404（不执行中间件）
   * 2. 使用递归 compose 函数构建中间件链（洋葱模型）
   * 3. 执行中间件链，最终调用路由 handler
   * 
   * 洋葱模型执行逻辑：
   * - compose(index) 返回一个函数，该函数执行第 index 个中间件
   * - 当 index >= middlewares.length 时，返回执行 handler 的函数（递归终止条件）
   * - 否则返回执行当前中间件并传入 compose(index+1) 作为 next 的函数
   * - 这样形成：middleware[0] -> middleware[1] -> ... -> handler -> ... -> middleware[1] -> middleware[0]
   */
  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const route = this.routes.find(
      (r) => r.method === req.method && r.path === url.pathname
    );
    
    // 没有找到路由，直接返回 404，不执行中间件
    if (!route) {
      return new Response("Not Found", { status: 404 });
    }

    // 递归 compose 函数，构建中间件链
    // 从后向前组合，形成洋葱模型
    const compose = (index: number): (req: Request) => Promise<Response> => {
      // 递归终止条件：所有中间件执行完毕，执行路由 handler
      if (index >= this.middlewares.length) {
        return (req: Request) => Promise.resolve(route.handler(req));
      }

      // 获取当前中间件
      const middleware = this.middlewares[index];
      
      // 返回执行当前中间件的函数，next 参数是 compose(index + 1)
      // 这样保证中间件按注册顺序执行（0 -> 1 -> 2 -> ...）
      return (req: Request) => middleware(req, compose(index + 1));
    };

    // 从第 0 个中间件开始执行中间件链
    return compose(0)(req);
  }
}