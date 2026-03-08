export type Handler = (req: Request) => Response | Promise<Response>;

/**
 * 中间件类型：洋葱模型中间件函数
 * @param req - 请求对象
 * @param next - 下一个中间件或最终 handler，调用它以继续执行链
 * @returns 返回 Response 对象
 */
export type Middleware = (req: Request, next: (req: Request) => Promise<Response>) => Promise<Response>;

interface Route {
  method: string;
  path: string;
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];
  private middlewares: Middleware[] = [];

  /**
   * 注册中间件
   * @param middleware - 中间件函数
   * @returns 返回 this 以支持链式调用
   */
  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  get(path: string, handler: Handler): this {
    this.routes.push({ method: "GET", path, handler });
    return this;
  }

  post(path: string, handler: Handler): this {
    this.routes.push({ method: "POST", path, handler });
    return this;
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const route = this.routes.find(
      (r) => r.method === req.method && r.path === url.pathname
    );
    if (!route) {
      // 未找到匹配路由，直接返回 404，不执行中间件
      return new Response("Not Found", { status: 404 });
    }

    // 构建洋葱模型执行链：从 handler 开始，反向遍历 middlewares
    // 第一个注册的中间件在最外层，最后一个在最内层（靠近 handler）
    // 这样确保了中间件按注册顺序执行（先进后出）
    let next: (req: Request) => Promise<Response> = async (r) => route.handler(r);
    
    // 从最后一个中间件开始，向前遍历，每个中间件包装下一个函数
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const middleware = this.middlewares[i];
      const currentNext = next;
      next = async (r) => middleware(r, currentNext);
    }

    // 执行中间件链（如果没有中间件，next 直接调用 handler）
    return next(req);
  }
}