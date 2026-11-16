# Liquid 4.0.3 calls tainted?/taint/untaint, which Ruby 3.2 removed.
# Stub them so Jekyll 4.2 builds on Ruby 3.2.
class Object
  def tainted?; false; end unless method_defined?(:tainted?)
  def taint; self; end unless method_defined?(:taint)
  def untaint; self; end unless method_defined?(:untaint)
end
